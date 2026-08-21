const jwt = require("jsonwebtoken");
const jwksClient = require("jwks-rsa");
require('dotenv').config();

const client = jwksClient({
  jwksUri: process.env.SOCIALACCOUNT_OIDC_CERTS
});

function getKey(header, callback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    const signingKey = key.getPublicKey();
    callback(null, signingKey);
  });
}

// Consulta el perfil administrativo resuelto por Django (/administration/me/)
// para conceder privilegios a administradores y editores de la plataforma.
async function hasModuleAdministratorProfile(authHeader) {
  const url = process.env.SIGIC_ADMINISTRATION_ME_URL;
  if (!url) return false;
  try {
    const response = await fetch(url, { headers: { Authorization: authHeader } });
    if (!response.ok) return false;
    const profile = (await response.json())?.profile;
    return ["superuser", "administrator", "editor"].includes(profile);
  } catch {
    return false;
  }
}

function validarToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).send("Falta token");
  
    const token = auth.split(" ")[1];

    jwt.verify(
      token,
      getKey,
      {
        //audience: "sigic_geonode",
        issuer: process.env.SOCIALACCOUNT_OIDC_ID_TOKEN_ISSUER
      },
      async (err, decoded) => {
        if (err) return res.status(401).send({ message: "Token inválido" });
        req.user = decoded;

        // Evalúa privilegios globales por rol en Keycloak o por perfil de administración en Django
        const realmRoles = decoded?.realm_access?.roles || [];
        const resourceRoles = Object.values(decoded?.resource_access || {})
          .flatMap((resource) => resource?.roles || []);
        const hasKeycloakRole = [...realmRoles, ...resourceRoles]
          .includes("levantamiento-admin");
        req.isLevantamientoAdmin = hasKeycloakRole ||
          await hasModuleAdministratorProfile(auth);

        // Normaliza el correo del usuario para comparaciones de permisos y autoría
        req.userEmail = String(decoded?.email || decoded?.preferred_username || "")
          .trim()
          .toLowerCase();
        next();
      }
    );
}
  
module.exports = { validarToken };
  
