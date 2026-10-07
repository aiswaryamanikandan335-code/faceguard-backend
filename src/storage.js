// Face photo storage. Production: Cloudinary, uploaded as "authenticated" (private) images that can only be
// opened through a signed link that expires. Tests: an in-memory stand-in with the same interface.
const config = require('./config');

function cloudinaryStorage() {
  const cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: config.cloudinary.cloudName,
    api_key: config.cloudinary.apiKey,
    api_secret: config.cloudinary.apiSecret,
    secure: true,
  });

  return {
    async upload(buffer, userId) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: config.cloudinary.folder,
              public_id: userId,
              type: 'authenticated', // not publicly readable
              resource_type: 'image',
              overwrite: true,
              format: 'jpg',
            },
            (error, res) => (error ? reject(error) : resolve(res))
          )
          .end(buffer);
      });
      return { publicId: result.public_id, version: result.version, format: result.format };
    },

    /** A download link that stops working after config.faceUrlSeconds. */
    url(face) {
      if (!face || !face.publicId) return null;
      return cloudinary.utils.private_download_url(face.publicId, face.format || 'jpg', {
        type: 'authenticated',
        expires_at: Math.floor(Date.now() / 1000) + config.faceUrlSeconds,
      });
    },

    async remove(publicId) {
      await cloudinary.uploader.destroy(publicId, { type: 'authenticated', resource_type: 'image' });
    },
  };
}

function memoryStorage() {
  const files = new Map();
  return {
    files,
    async upload(buffer, userId) {
      const publicId = `faceguard/faces/${userId}`;
      files.set(publicId, buffer);
      return { publicId, version: 1, format: 'jpg' };
    },
    url(face) {
      if (!face || !face.publicId) return null;
      // Tests check the memory:// form; the local dev server serves photos at /dev/face/<publicId>.jpg.
      return process.env.NODE_ENV === 'test'
        ? `memory://${face.publicId}.jpg`
        : `http://localhost:${process.env.PORT || 3000}/dev/face/${face.publicId}.jpg`;
    },
    async remove(publicId) {
      files.delete(publicId);
    },
  };
}

// Local development: photos as files in a folder, served by the dev server at /dev/face/<publicId>.jpg.
function diskStorage() {
  const fs = require('fs');
  const path = require('path');
  const root = path.resolve(process.env.DISK_DIR || '.devdata/faces');
  const fileOf = (publicId) => path.join(root, ...publicId.split('/')) + '.jpg';
  return {
    root,
    fileOf,
    async upload(buffer, userId) {
      const publicId = `faceguard/faces/${userId}`;
      const file = fileOf(publicId);
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.writeFile(file, buffer);
      return { publicId, version: 1, format: 'jpg' };
    },
    url(face) {
      return face && face.publicId ? `http://localhost:${process.env.PORT || 3000}/dev/face/${face.publicId}.jpg` : null;
    },
    async remove(publicId) {
      await fs.promises.rm(fileOf(publicId), { force: true });
    },
  };
}

module.exports =
  config.storageDriver === 'memory' ? memoryStorage() :
  config.storageDriver === 'disk' ? diskStorage() :
  cloudinaryStorage();
