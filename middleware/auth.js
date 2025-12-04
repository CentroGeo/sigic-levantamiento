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

function validarToken(req, res, next) {
    const auth = req.headers.authorization;
    if (!auth) return res.status(401).send("Falta token");
  
    const token = auth.split(" ")[1];

    // jwt.verify(token, getKey, { issuer: "process.env.SOCIALACCOUNT_OIDC_ID_TOKEN_ISSUER" }, (err, decoded) => {
    //     if (err) {
    //       console.log("Error de verificación:", err.message);
    //       return res.status(401).send("Token inválido ❌");
    //     }
    //     console.log("Token decodificado:", decoded);
    //     req.user = decoded;
    //     next();
    //   });

    jwt.verify(
      token,
      getKey,
      {
        //audience: "sigic_geonode",
        issuer: process.env.SOCIALACCOUNT_OIDC_ID_TOKEN_ISSUER
      },
      (err, decoded) => {
        console.log(err)
        if (err) return res.status(401).send("Token inválido ❌");
        req.user = decoded;
        next();
      }
    );
}
  
module.exports = { validarToken };
  
