#!/usr/bin/env node
/**
 * Generate S3 Presigned POST
 * Usage: node generate-presigned-post.js <bucket> <key> [region] [expires-in]
 * 
 * Example: node generate-presigned-post.js my-bucket frame.png us-east-1 3600
 * 
 * Requires AWS credentials to be configured (via env vars or ~/.aws/credentials)
 */

const crypto = require('crypto');

// Parse command line arguments
const args = process.argv.slice(2);

if (args.length < 2) {
	console.error('Usage: node generate-presigned-post.js <bucket> <key> [region] [expires-in]');
	console.error('');
	console.error('Arguments:');
	console.error('  bucket      - S3 bucket name (required)');
	console.error('  key         - Object key/path (required)');
	console.error('  region      - AWS region (optional, default: us-east-1)');
	console.error('  expires-in  - Expiration in seconds (optional, default: 3600)');
	console.error('');
	console.error('Example:');
	console.error('  node generate-presigned-post.js leonardoai-temporary-uploads-dev frame.png us-east-1 3600');
	process.exit(1);
}

// Configuration from arguments
const BUCKET_NAME = args[0];
const OBJECT_KEY = args[1];
const AWS_REGION = args[2] || 'us-east-1';
const EXPIRES_IN_SECONDS = parseInt(args[3] || '3600', 10);

// Get AWS credentials from environment
const AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID;
const AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY;

if (!AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
	console.error('Error: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set');
	console.error('');
	console.error('Set them via environment variables:');
	console.error('  export AWS_ACCESS_KEY_ID=your_access_key');
	console.error('  export AWS_SECRET_ACCESS_KEY=your_secret_key');
	process.exit(1);
}

// Generate ISO8601 date strings
const now = new Date();
const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
const dateTime = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
const expirationDate = new Date(now.getTime() + EXPIRES_IN_SECONDS * 1000).toISOString();

// Create credential scope
const credential = `${AWS_ACCESS_KEY_ID}/${dateStamp}/${AWS_REGION}/s3/aws4_request`;

// Create policy
const policy = {
	expiration: expirationDate,
	conditions: [
		{ bucket: BUCKET_NAME },
		{ key: OBJECT_KEY },
		{ acl: 'private' },
		['content-length-range', 0, 10485760], // Max 10MB
		{ 'x-amz-algorithm': 'AWS4-HMAC-SHA256' },
		{ 'x-amz-credential': credential },
		{ 'x-amz-date': dateTime }
	]
};

// Encode policy
const policyBase64 = Buffer.from(JSON.stringify(policy)).toString('base64');

// Create signature
function getSignatureKey(key, dateStamp, regionName, serviceName) {
	const kDate = crypto.createHmac('sha256', 'AWS4' + key).update(dateStamp).digest();
	const kRegion = crypto.createHmac('sha256', kDate).update(regionName).digest();
	const kService = crypto.createHmac('sha256', kRegion).update(serviceName).digest();
	const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
	return kSigning;
}

const signingKey = getSignatureKey(AWS_SECRET_ACCESS_KEY, dateStamp, AWS_REGION, 's3');
const signature = crypto.createHmac('sha256', signingKey).update(policyBase64).digest('hex');

// Output the presigned POST data
const presignedPost = {
	url: `https://${BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com`,
	fields: {
		key: OBJECT_KEY,
		acl: 'private',
		'x-amz-algorithm': 'AWS4-HMAC-SHA256',
		'x-amz-credential': credential,
		'x-amz-date': dateTime,
		policy: policyBase64,
		'x-amz-signature': signature
	}
};

console.log('\nPresigned POST Data:');
console.log(JSON.stringify(presignedPost, null, 2));
console.log('\n\nTo use in your app, paste this entire JSON into the presigned URL field.');

