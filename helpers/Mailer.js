const config = require('../config/config.dev');
const path = require("path");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require('google-auth-library');
const fs = require('fs').promises;
const appRoot = require("app-root-path");

class Mailer {
  constructor() {
    this.TOKEN_PATH = appRoot + "/server/config/token.json";
    this.CREDENTIAL_PATH = appRoot + "/server/config/credentials.json";
    this.CREDENTIALS = null;
  }

  async getClient() {
    if (this.auth == null) {
      this.CREDENTIALS = await fs.readFile(this.CREDENTIAL_PATH);
      this.auth = await this.authorize(JSON.parse(this.CREDENTIALS));
    }
    return this.auth;
  }

  async authorize(credentials) {
    const { client_secret, client_id, redirect_uris } = credentials.web;
    const oauth2Client = new OAuth2Client(client_id, client_secret, redirect_uris[0]);

    try {
      let token = await fs.readFile(this.TOKEN_PATH);
      token = JSON.parse(token);
      oauth2Client.setCredentials(token);

      console.log("EXPIRED", oauth2Client.isTokenExpiring())
      if (oauth2Client.isTokenExpiring()) {
        await this.getAccessToken(oauth2Client);
      }
    } catch (error) {
      console.log("ERROR", error)
      await this.getAccessToken(oauth2Client);
    }

    return oauth2Client;
  }

  async getAccessToken(oauth2Client) {
    const access_token = await oauth2Client.getAccessToken()
    const tokenInfo = await oauth2Client.getTokenInfo(
      access_token.token
    );
    oauth2Client.credentials.access_token = access_token.token;
    oauth2Client.credentials.expiry_date = tokenInfo.expiry_date;

    await fs.writeFile(this.TOKEN_PATH, JSON.stringify(oauth2Client.credentials));
  }

  async send(subject, receivers) {
    let auth = await this.getClient();

    let information = {
      from: config.email.alias,
      to: receivers,
      subject: subject,
      html: this.template,
    };

    if (this.attachment) {
      this.information.attachments = this.attachment;
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: "app.apporta@gmail.com",
        clientId: auth._clientId,
        clientSecret: auth._clientSecret,
        accessToken: auth.credentials.access_token,
        refreshToken: auth.credentials.refresh_token,
        expires: auth.credentials.expiry_date
      },
    });

    return transporter.sendMail(information);
  }

  addAttachment(path) {
    this.attachment = [{ path: path }];
  }

  // TODO: change domine
  forgotPassTemplate(context) {
    const link = `https://apporta.geoint.mx/reset_password?token=${context.token}`;

    this.template = `<!DOCTYPE html>
        <html lang="en" dir="ltr">
            <head>
                <meta charset="utf-8">
                <title>Restablecimiento de contraseña</title>
            </head>
            <body>
                <h3>Estimado(a) ${context.name},</h3>
                <p>Solicitó un restablecimiento de contraseña,
                    use este <a href="${link}">enlace</a> para restablecer su contraseña</p>
                <br>
                <p>¡Gracias!</p>
            </body>
        </html>`;
  }


  forgotPassTemplateApp(context) {
    this.template = `<!DOCTYPE html>
        <html lang="en" dir="ltr">
            <head>
                <meta charset="utf-8">
                <title>Restablecimiento de contraseña</title>
            </head>
            <body>
                <h3>Estimado(a) ${context.name},</h3>
                <p>Solicitó un restablecimiento de contraseña,
                    use este código <b>${context.token}</b> para restablecer su contraseña</p>
                <br>
                <p>¡Gracias!</p>
            </body>
        </html>`;
  }


  resetPassTemplate(context) {
    this.template = `<!DOCTYPE html>
        <html lang="en" dir="ltr">
            <head>
                <meta charset="utf-8">
                <title>Contraseña Restablecida</title>
            </head>
            <body>
                <div>
                    <h3>Estimado(a) usuario(a),</h3>
                    <p>Su contraseña se ha restablecido correctamente, ahora
                         usted puede iniciar sesión con su nueva contraseña.</p>
                    <br>
                    <div>
                        ¡Gracias!
                    </div>
                </div>
            </body>
        </html>`;
  }

  complaintTemplate(context) {
    this.template = `<!DOCTYPE html>
                    <html lang="en" dir="ltr">
                        <head>
                            <meta charset="utf-8">
                            <title>Denuncia de ${context.name}</title>
                        </head>
                        <body>
                            <div>
                                <h3>Hola,</h3>
                                <p> Se hace presente la siguiente denuncia en chappultepec por
                                    parte de un usuario con la siguiente evidencia.</p>
                                <br>
                                <div>
                                    ¡Gracias!
                                </div>
                            </div>
                        </body>
                    </html>`;
    return this;
  }

  welcomeTemplate(context) {
    let userType = "";
    let passText = "";

    if (context.type == "visitor") userType = "visitante";
    if (context.type == "monitor") userType = "monitor";
    if (context.type == "authority") {
      userType = "autoridad";
      passText = `<br><div>Su contraseña temporal es: ${context.password}</div>`;
    }

    this.template = `<!DOCTYPE html>
          <html lang="en" dir="ltr">
              <head>
                  <meta charset="utf-8">
                  <title>¡Registro exitoso!</title>
              </head>
              <body>
                  <div>
                      <h3>Hola ${context.name},</h3>
                      <p>Su cuenta de ${userType} ha sido creada
                      exitosamente — ahora puede usar la aplicación y disfrutar
                      de sus funcionalidades</p>
                      ${passText}
                      <br>
                      <div>
                          ¡Bienvenido!
                      </div>
                  </div>
              </body>
          </html>`;
  }

  templateGuestUser(context) {
    const link = `https://apporta.geoint.mx`;
    const link_registro = link + `/registro`;
    const link_manual_app = link + `/resources/manual/MiApptsil_Manual_de_Usuario_-_App_movil.pdf`;
    const link_manual_web = link + `/resources/manual/MiApptsil_Manual_de_Usuario_-_Plataforma_web.pdf`;
    const link_app_android = `https://play.google.com/store/apps/details?id=com.centrogeo.apporta&pli=1`;
    const link_app_ios = `https://apps.apple.com/app/apporta/id6472007951`;

    const link_logo = link + `/resources/img/logo-app_512.png`;
    const link_footer = link + `/resources/img/footer.png`;
    const link_header = link + `/resources/img/header.png`;
    const link_apple = link + `/resources/img/appstore.png`
    const link_google = link + `/resources/img/playstore.png`

    this.template = `<!DOCTYPE html>
<html lang="en" dir="ltr">

<head>
    <meta charset="utf-8">
    <title>Invitación a participar en el proyecto apporta</title>
    <style>
        #body {
            width: 50%;
        }

        .header img,
        .footer img {
            width: 100%;
        }

        .body {
            color: #577492;
            padding: 2rem 1rem;
        }

        .body .title {
            font-size: 1.5rem;
            line-height: 2rem;
        }

        .body .content,
        .body li {
            font-size: 1.125rem;
            line-height: 1.75rem;
        }

        .body li img.apple {
            height: 40px;
        }

        .body li img.google {
            height: 50px;
        }

        .body .footer {
            font-size: 0.875rem;
            line-height: 1.25rem;
            text-align: center;
        }
    </style>
</head>

<body>
    <div id="body">
        <div class="header">
            <img src="${link_header}" />
        </div>
        <div class="body">
            <div class="title">Estimado(a) usuario(a).</div>
            <div class="content">La Secretaría de la Cultura y las Artes de Yucatán a través de la Dirección de
                Patrimonio y
                Centro Geo te
                invita a participar en el proyecto Apporta.</div>
            <div class="content">Es muy fácil empezar a formar parte de la comunidad de patrimonieros, tan solo tendrás
                que
                realizar tres
                pasos:</div>
            <ol>
                <li>
                    <div>Descarga la app</div>
                    <table>
                        <tr>
                            <td>
                                <a href="${link_app_ios}">
                                    <img class="apple" src="${link_apple}" alt="">
                                </a>
                            </td>
                            <td>
                                <a href="${link_app_android}">
                                    <img class="google" src="${link_google}" alt="">
                                </a>
                            </td>
                        </tr>
                    </table>
                </li>
                <li>Regístrate</li>
                <li>Con tu cuenta de usuario y contraseña consulta tus registros y los de otros usuarios en el sitio
                    web: <a href="${link}">https://apporta.geoint.mx/</a></li>
            </ol>
            <div class="footer">Este correo se generó automáticamente por el sistema. No responder a esta dirección.
            </div>
        </div>
        <div class="footer">
            <img src="${link_footer}" />
        </div>
    </div>
</body>

</html>`;
    
  }
}



module.exports = Mailer;
