const fs = require('fs');
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
const uploadFoodImages = (req, res, next) => { req.uploadImageType = 'food'; foodUpload.array('images', 5)(req, res, next); };
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
