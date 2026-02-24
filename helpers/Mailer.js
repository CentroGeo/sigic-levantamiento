const config = require('../config/config.dev');
const path = require("path");
const nodemailer = require("nodemailer");

class Mailer {
    constructor() {
        this.attachment = null;
        this.template = "";
    }

    async send(subject, receivers) {
        let information = {
            from: `"${config.email.from.name}" <${config.email.from.email}>`,
            to: receivers,
            subject: subject,
            html: this.template,
        };

        if (this.attachment) {
            information.attachments = this.attachment;
        }

        const transporter = nodemailer.createTransport(config.email.smtp);

        return transporter.sendMail(information);
    }

    addAttachment(path) {
        this.attachment = [{ path: path }];
    }

    templateGuestUser() {
        const link = `https://sigic.dev.geoint.mx/`;
        
        this.template = `<!DOCTYPE html>
        <html lang="en" dir="ltr">

        <head>
            <meta charset="utf-8">
            <title>Invitación a participar en el modulo de levantamiento</title>
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
                <div class=" ">
                    <div class="title">Estimado(a) usuario(a): </div>
                    <div class="content"> Ha sido seleccionado(a) para participar en un proyecto de levantamiento.</div>
                    <ol>
                        <li>Regístrate <a href="${link}">https://sigic.dev.geoint.mx/</a></li>
                    </ol>
                </div>
                <div class="footer">Este correo se generó automáticamente por el sistema. No responder a esta dirección.
                </div>
            </body>
        </html>`;

    }
}



module.exports = Mailer;
