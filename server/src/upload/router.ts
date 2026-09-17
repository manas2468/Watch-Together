// ============================================================================
// Watch Together — File Upload Router
// ============================================================================
// Handles file uploads (Multer, 500MB cap) and serves them with proper
// Range-request support (required for video seeking in <video> elements).
// Files are cleaned up when their room is deleted.

import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500MB

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${uuidv4()}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    const allowedMimes = [
      'video/mp4',
      'video/webm',
      'video/ogg',
      'audio/mpeg',
      'audio/mp3',
      'audio/ogg',
      'audio/webm',
      'audio/wav',
      'application/vnd.apple.mpegurl', // m3u8
      'video/mp2t', // ts segments
    ];
    if (allowedMimes.includes(file.mimetype) || file.originalname.match(/\.(mp4|webm|ogg|mp3|m3u8|ts|wav)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type. Allowed: mp4, webm, ogg, mp3, m3u8, wav'));
    }
  },
});

export const uploadRouter = Router();

/**
 * POST /api/upload
 * Upload a media file. Returns the URL to access it.
 */
uploadRouter.post('/upload', upload.single('file'), (req: Request, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded.' });
      return;
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      url: fileUrl,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });

    console.log(`[Upload] File uploaded: ${req.file.originalname} (${(req.file.size / 1024 / 1024).toFixed(1)}MB)`);
  } catch (err) {
    console.error('[Upload] Error:', err);
    res.status(500).json({ error: 'Upload failed.' });
  }
});

/**
 * Multer error handler middleware.
 * Must be registered after the upload route.
 */
uploadRouter.use((err: any, _req: Request, res: Response, next: Function) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(413).json({ error: 'File too large. Maximum size is 500MB.' });
      return;
    }
    res.status(400).json({ error: err.message });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message || 'Upload failed.' });
    return;
  }
  next();
});

/**
 * Serve uploaded files with Range request support.
 * Range requests are REQUIRED for video seeking to work properly.
 *
 * GET /uploads/:filename
 */
export function serveUploads(req: Request, res: Response): void {
  try {
    const filename = Array.isArray(req.params.filename) ? req.params.filename[0] : req.params.filename;
    if (!filename || typeof filename !== 'string' || filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      res.status(400).send('Invalid filename');
      return;
    }

    const filepath = path.join(UPLOAD_DIR, filename);
    if (!fs.existsSync(filepath)) {
      res.status(404).send('File not found');
      return;
    }

    const stat = fs.statSync(filepath);
    const fileSize = stat.size;

    // Determine content type
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
      '.ogg': 'video/ogg',
      '.mp3': 'audio/mpeg',
      '.wav': 'audio/wav',
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.ts': 'video/mp2t',
    };
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    const rangeHeader = req.headers.range;
    const range = typeof rangeHeader === 'string' ? rangeHeader : undefined;

    if (range) {
      // Parse Range header: "bytes=start-end"
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize || start > end) {
        res.status(416).header('Content-Range', `bytes */${fileSize}`).send();
        return;
      }

      const chunkSize = end - start + 1;
      const stream = fs.createReadStream(filepath, { start, end });

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': contentType,
      });

      stream.pipe(res);
    } else {
      // No Range header — send the whole file
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': contentType,
        'Accept-Ranges': 'bytes',
      });

      fs.createReadStream(filepath).pipe(res);
    }
  } catch (err) {
    console.error('[Upload] Serve error:', err);
    res.status(500).send('Server error');
  }
}

/**
 * Delete all uploaded files for a room.
 * Called when a room is cleaned up.
 */
export function cleanupUploads(filenames: string[]): void {
  for (const filename of filenames) {
    const filepath = path.join(UPLOAD_DIR, filename);
    try {
      if (fs.existsSync(filepath)) {
        fs.unlinkSync(filepath);
        console.log(`[Upload] Cleaned up: ${filename}`);
      }
    } catch (err) {
      console.error(`[Upload] Cleanup error for ${filename}:`, err);
    }
  }
}
