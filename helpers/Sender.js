const gcm = require('node-gcm');
const config = require('../config/config.dev');

// message =  { title: '', body: '' }

class Sender {
    constructor(recipients, message, data, users_type) {
        this.recipients = recipients;
        message["sound"] = "default"
        this.message = message;
        this.data = config.notifications.android;
        this.data.custom = data;
        this.users_type = users_type;
    }

    async send() {
        return await this._toAndroid();
    }

    _toAndroid() {
        return new Promise((resolve, reject) => {
            if (!this.message || !this.recipients) {
                return reject(new Error('Notification values are missing'));
            }
            
            
            const gcmMessage = new gcm.Message({
                notification: this.message,
                data: this.data
            });

        });
    }

    _toIOS() {
        console.log("to ios", this.message);
    }
}

module.exports = Sender;
