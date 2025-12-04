const fs = require('fs');
const multer = require('multer');

class Filer {
    constructor(foldername, validation) {
        this.foldername = foldername || 'other';
        this.validation = validation || 'other';

        this.upload = multer({
            storage: multer.diskStorage({
                destination: this._destination.bind(this),
                filename: this._filename
            }),
            // limits: { fileSize: 1024 * 1024 * 5 /*5mb*/ },
            fileFilter: this._fileFilter.bind(this)
        });
    }

    sigleUpload(fieldname) {
        return this.upload.single(fieldname);
    }

    tripleUpload(firstImageName, secondImageName, kmlName) {
        return this.upload.fields([
          { name: firstImageName, maxCount: 1 },
          { name: secondImageName, maxCount: 1 },
          { name: kmlName, maxCount: 1 }
        ]);
    }

    _fileFilter(req, file, cb) {
        // kml? --> application/octet-stream
        console.log(file.mimetype);
        if( this.validation == 'imagen' ){
            if ( file.mimetype === 'image/jpeg' || 
                file.mimetype === 'image/png'){
                cb(null, true);    
            }
            else{
                cb(null, false);    
            }
        }

        if (this.validation == "other") {
          if (
            file.mimetype === 'image/jpeg'
            || file.mimetype === 'image/png'
            || file.mimetype === 'audio/mpeg'
            || file.mimetype === 'video/mp4'
            || file.mimetype === 'custom/multi'
            // || file.mimetype === 'application/octet-stream'
            // || file.mimetype === 'application/vnd.google-earth.kml+xml'
            // || file.mimetype === 'application/vnd.google-earth.kmz'
          ) {
            cb(null, true);
          } else {
            cb(null, false); // null can be a new error
          }
        }
    }

    _destination(req, file, cb) {
        let path = '';
        switch (file.mimetype) {
          case "image/png":
            path = `./uploads/${this.foldername}/images`;
            break;
          case "image/jpeg":
            path = `./uploads/${this.foldername}/images`;
            break;
          case "audio/mpeg":
            path = `./uploads/${this.foldername}/audio`;
            break;
          case "video/mp4":
            path = `./uploads/${this.foldername}/video`;
            break;
          default:
            path = `./uploads/${this.foldername}`;
        }

        fs.exists(path, exist => {
            if (!exist) {
                return fs.mkdir(path, { recursive: true } , error => cb(error, path))
            }
            return cb(null, path)
        })
    }

    _filename(req, file, cb) {
        cb(null, file.originalname);
    }
}

module.exports = Filer;
