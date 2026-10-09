const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');

const uploadRoot = path.join(__dirname, '..', 'uploads');
const destinations = {
  logo: path.join(uploadRoot, 'business-logo'),
  cover: path.join(uploadRoot, 'business-cover'),
  food: path.join(uploadRoot, 'food-images'),
  profile: path.join(uploadRoot, 'profile'),
  deliveryProof: path.join(uploadRoot, 'delivery-proof')
};
Object.values(destinations).forEach(folder => fs.mkdirSync(folder, { recursive: true }));

const storage = multer.diskStorage({
  destination: (req, _file, callback) => callback(null, destinations[req.uploadImageType]),
  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    callback(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${extension}`);
  }
});

const extensionByMimeType = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp']
};

const createImageFilter = (allowedMimeTypes, message) => (_req, file, callback) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  const allowedExtensions = extensionByMimeType[file.mimetype];
  if (!allowedMimeTypes.includes(file.mimetype) || !allowedExtensions || !allowedExtensions.includes(extension)) {
    return callback(new Error(message));
  }
  return callback(null, true);
};

const imageFilter = createImageFilter(
  ['image/png', 'image/jpeg'],
  'Only PNG, JPG, and JPEG image files are allowed.'
);

const upload = multer({ storage, fileFilter: imageFilter, limits: { fileSize: 2 * 1024 * 1024 } });
const uploadLogo = (req, res, next) => { req.uploadImageType = 'logo'; upload.single('image')(req, res, next); };
const uploadCover = (req, res, next) => { req.uploadImageType = 'cover'; upload.single('image')(req, res, next); };
const foodFilter = createImageFilter(
  ['image/png', 'image/jpeg', 'image/webp'],
  'Only PNG, JPG, JPEG, and WEBP image files are allowed.'
);
const foodUpload = multer({ storage, fileFilter: foodFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const imageContentMatchesType = async file => {
  const handle = await fsp.open(file.path, 'r');
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (file.mimetype === 'image/png') return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    if (file.mimetype === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    if (file.mimetype === 'image/webp') return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    return false;
  } finally { await handle.close(); }
};
const removeUploadedFiles = files => Promise.all((files || []).map(file => fsp.unlink(file.path).catch(() => {})));
const uploadFoodImages = (req, res, next) => {
  req.uploadImageType = 'food';
  foodUpload.array('images', 5)(req, res, async error => {
    if (error) {
      await removeUploadedFiles(req.files);
      if (error instanceof multer.MulterError) {
        error.statusCode = error.code === 'LIMIT_FILE_SIZE' ? 400 : 422;
        error.message = error.code === 'LIMIT_FILE_SIZE'
          ? 'Image size must not exceed 5MB.'
          : 'Upload up to five images using the images field.';
      }
      return next(error);
    }
    try {
      for (const file of req.files || []) {
        if (!await imageContentMatchesType(file)) {
          await removeUploadedFiles(req.files);
          return res.status(400).json({ success: false, message: 'Each upload must be a valid PNG, JPG, JPEG, or WEBP image.' });
        }
      }
      // If validation, persistence, or another downstream step fails, remove
      // the staged files so failed submissions do not leave orphaned uploads.
      res.once('finish', () => {
        if (res.statusCode >= 400) void removeUploadedFiles(req.files);
      });
      return next();
    } catch (validationError) {
      await removeUploadedFiles(req.files);
      return next(validationError);
    }
  });
};
const volunteerUpload = multer({ storage, fileFilter: foodFilter, limits: { fileSize: 5 * 1024 * 1024 } });
const uploadVolunteerProfile = (req, res, next) => {
  req.uploadImageType = 'volunteerProfile';
  req.uploadImageMaxSize = '5MB';
  volunteerUpload.single('image')(req, res, next);
};
const uploadProfileImage = (req, res, next) => {
  req.uploadImageType = 'profile';
  req.uploadImageMaxSize = '5MB';
  volunteerUpload.single('image')(req, res, next);
};
const uploadDeliveryProof = (req, res, next) => {
  req.uploadImageType = 'deliveryProof';
  req.uploadImageMaxSize = '5MB';
  volunteerUpload.single('image')(req, res, next);
};
const uploadProofPhoto = (req, res, next) => {
  req.uploadImageType = 'deliveryProof';
  req.uploadImageMaxSize = '5MB';
  volunteerUpload.single('image')(req, res, next);
};

module.exports = { uploadLogo, uploadCover, uploadFoodImages, uploadVolunteerProfile, uploadProfileImage, uploadDeliveryProof, uploadProofPhoto };
