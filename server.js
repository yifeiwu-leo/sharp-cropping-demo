'use strict';

const path = require('path');
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const { put, head } = require('@vercel/blob');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

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

		if (format === 'png') {
			res.type('png');
			return pipeline.png({ compressionLevel: 9 }).toBuffer().then(buf => res.end(buf));
		}
		if (format === 'webp') {
			res.type('webp');
			return pipeline.webp({ quality: 90 }).toBuffer().then(buf => res.end(buf));
		}

		res.type('jpeg');
		return pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer().then(buf => res.end(buf));
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

app.listen(PORT, () => {
	console.log(`Sharp cropping demo running at http://localhost:${PORT}`);
});


