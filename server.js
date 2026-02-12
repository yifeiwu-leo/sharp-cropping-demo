'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { put, head } = require('@vercel/blob');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const os = require('os');
const ffmpegStatic = require('ffmpeg-static');
const ffprobeStatic = require('ffprobe-static');

// Get paths - ffmpeg-static exports string directly, ffprobe-static exports object with .path
const ffmpegPath = ffmpegStatic;
const ffprobePath = ffprobeStatic.path;

const execAsync = promisify(exec);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

app.post('/upload', upload.single('image'), async (req, res) => {
	try {
		if (!req.file) {
			return res.status(400).json({ error: 'No file uploaded' });
		}
		
		const timestamp = Date.now();
		const random = Math.random().toString(36).slice(2, 8);
		const ext = path.extname(req.file.originalname) || '.jpg';
		const filename = `${timestamp}-${random}${ext}`;
		
		const blob = await put(filename, req.file.buffer, {
			access: 'public',
			contentType: req.file.mimetype || 'image/jpeg'
		});
		
		return res.json({
			id: blob.pathname || filename
		});
	} catch (err) {
		console.error('Upload error:', err);
		return res.status(500).json({ error: 'Upload failed' });
	}
});

function parseIntOrDefault(value, fallback) {
	const n = parseInt(String(value), 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getFit(strategyParam) {
	const s = String(strategyParam || '').toLowerCase();
	switch (s) {
		case 'cover':
			return sharp.fit.cover;
		case 'contain':
			return sharp.fit.contain;
		case 'fill':
			return sharp.fit.fill;
		case 'inside':
			return sharp.fit.inside;
		case 'outside':
			return sharp.fit.outside;
		default:
			return sharp.fit.cover;
	}
}

function getPosition(strategyParam) {
	const s = String(strategyParam || '').toLowerCase();
	switch (s) {
		case 'entropy':
			return sharp.strategy.entropy;
		case 'attention':
			return sharp.strategy.attention;
		case 'center':
		case 'centre':
		default:
			return 'center';
	}
}

app.get('/image/:id/:strategy', async (req, res) => {
	try {
		const { id, strategy } = req.params;
		const width = parseIntOrDefault(req.query.w, 400);
		const height = parseIntOrDefault(req.query.h, 300);
		const format = (req.query.format || 'jpeg').toString().toLowerCase();

		// Get blob metadata to retrieve the public URL
		let blobInfo;
		try {
			blobInfo = await head(id);
		} catch (err) {
			return res.status(404).send('Not found');
		}
		
		if (!blobInfo || !blobInfo.url) {
			return res.status(404).send('Not found');
		}
		
		// Fetch the blob from its public URL
		const response = await fetch(blobInfo.url);
		if (!response.ok) {
			return res.status(404).send('Not found');
		}
		
		const imageBuffer = Buffer.from(await response.arrayBuffer());

		let pipeline = sharp(imageBuffer).rotate();
		
		// Parse strategy to extract fit and position
		const strategyParts = strategy.split('-');
		const fitStrategy = strategyParts[0];
		const positionStrategy = strategyParts[1] || 'center';
		
		const resizeOptions = {
			width,
			height,
			fit: getFit(fitStrategy)
		};
		
		// Only add position for cover fit (it's used for cropping)
		if (getFit(fitStrategy) === sharp.fit.cover) {
			resizeOptions.position = getPosition(positionStrategy);
		}
		
		pipeline = pipeline.resize(resizeOptions);

		res.type('png');
		return pipeline.png({ compressionLevel: 8, palette: true }).toBuffer().then(buf => res.end(buf));
	} catch (err) {
		console.error('Image processing error:', err);
		return res.status(500).send('Processing failed');
	}
});

app.get('/strategies', (_req, res) => {
	res.json([
		{ key: 'cover', label: 'Cover (crop to fill)' },
		{ key: 'cover-entropy', label: 'Cover with Entropy' },
		{ key: 'cover-attention', label: 'Cover with Attention' },
		{ key: 'contain', label: 'Contain (fit within)' },
		{ key: 'fill', label: 'Fill (stretch)' },
		{ key: 'inside', label: 'Inside (fit within, preserve aspect)' },
		{ key: 'outside', label: 'Outside (cover, preserve aspect)' }
	]);
});

app.post('/video/frame', async (req, res) => {
	try {
		const { url } = req.body;
		
		if (!url || typeof url !== 'string') {
			return res.status(400).json({ error: 'Video URL is required' });
		}

		// Validate URL format
		try {
			new URL(url);
		} catch (err) {
			return res.status(400).json({ error: 'Invalid URL format' });
		}

		// Create temporary file for the video
		const tempVideoPath = path.join(os.tmpdir(), `video-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		const tempFramePath = path.join(os.tmpdir(), `frame-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);

		try {
			// Download only the first part of the video (usually sufficient for first frame)
			// Try to get first 10MB - enough for most video headers + first frame
			const PARTIAL_SIZE = 10 * 1024 * 1024; // 10MB
			
			let videoResponse = await fetch(url, {
				headers: { 'Range': `bytes=0-${PARTIAL_SIZE - 1}` }
			});
			
			// If server doesn't support range requests, fall back to full download
			if (videoResponse.status === 416 || videoResponse.status === 200) {
				if (videoResponse.status === 200) {
					console.log('Server does not support range requests, downloading full video');
				}
				videoResponse = await fetch(url);
			}
			
			if (!videoResponse.ok && videoResponse.status !== 206) {
				return res.status(400).json({ error: `Failed to fetch video: ${videoResponse.statusText}` });
			}
			
			const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
			await fs.promises.writeFile(tempVideoPath, videoBuffer);

			// Extract first frame using ffmpeg
			const ffmpegCommand = `"${ffmpegPath}" -i "${tempVideoPath}" -vframes 1 -f image2 "${tempFramePath}" -y`;
			await execAsync(ffmpegCommand);

			// Read the frame and convert to base64
			const frameBuffer = await fs.promises.readFile(tempFramePath);
			const frameBase64 = frameBuffer.toString('base64');

			// Get container info using ffprobe
			const ffprobeCommand = `"${ffprobePath}" -v quiet -print_format json -show_format -show_streams "${tempVideoPath}"`;
			const { stdout: probeOutput } = await execAsync(ffprobeCommand);
			const probeData = JSON.parse(probeOutput);

			// Extract video stream info
			const videoStream = probeData.streams?.find(s => s.codec_type === 'video');
			
			// Calculate FPS from avg_frame_rate or r_frame_rate
			let fps = null;
			if (videoStream?.avg_frame_rate) {
				const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
				fps = den > 0 ? num / den : null;
			} else if (videoStream?.r_frame_rate) {
				const [num, den] = videoStream.r_frame_rate.split('/').map(Number);
				fps = den > 0 ? num / den : null;
			}

			// Extract relevant info
			const videoInfo = {
				fps: fps,
				width: videoStream?.width || null,
				height: videoStream?.height || null,
				duration: probeData.format?.duration ? parseFloat(probeData.format.duration) : null,
				filesize: probeData.format?.size ? parseInt(probeData.format.size, 10) : null,
				codec: videoStream?.codec_name || null
			};

			// Clean up temporary files
			await fs.promises.unlink(tempVideoPath).catch(() => {});
			await fs.promises.unlink(tempFramePath).catch(() => {});

			return res.json({
				frame: frameBase64,
				videoInfo: videoInfo
			});

		} catch (err) {
			// Clean up temporary files on error
			await fs.promises.unlink(tempVideoPath).catch(() => {});
			await fs.promises.unlink(tempFramePath).catch(() => {});

			console.error('Video processing error:', err);
			
			if (err.message && err.message.includes('ffmpeg')) {
				return res.status(500).json({ error: 'ffmpeg error: ' + err.message });
			}
			if (err.message && err.message.includes('ffprobe')) {
				return res.status(500).json({ error: 'ffprobe error: ' + err.message });
			}
			
			return res.status(500).json({ error: 'Video processing failed: ' + err.message });
		}
	} catch (err) {
		console.error('Video frame endpoint error:', err);
		return res.status(500).json({ error: 'Request processing failed' });
	}
});

app.get('/video-player', (req, res) => {
	res.sendFile(path.join(__dirname, 'public', 'video-player.html'));
});

app.listen(PORT, () => {
	console.log(`Sharp cropping demo running at http://localhost:${PORT}`);
});


