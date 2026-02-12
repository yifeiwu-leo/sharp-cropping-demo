document.addEventListener('DOMContentLoaded', () => {
	const video = document.getElementById('videoPlayer');
	const canvas = document.getElementById('canvas');
	const form = document.getElementById('uploadForm');
	const presignedDataInput = document.getElementById('presignedData');
	const currentTimeDisplay = document.getElementById('currentTime');
	const statusMessage = document.getElementById('status');
	const submitBtn = document.getElementById('submitBtn');
	const btnText = submitBtn.querySelector('.btn-text');
	const btnSpinner = submitBtn.querySelector('.btn-spinner');

	// Update current time display
	video.addEventListener('timeupdate', () => {
		currentTimeDisplay.textContent = video.currentTime.toFixed(2);
	});

	// Handle form submission
	form.addEventListener('submit', async (e) => {
		e.preventDefault();
		
		const presignedDataStr = presignedDataInput.value.trim();
		
		if (!presignedDataStr) {
			showStatus('Please enter presigned POST data', 'error');
			return;
		}

		// Parse the presigned data
		let presignedData;
		try {
			presignedData = JSON.parse(presignedDataStr);
			
			// Handle nested structure (data.uploadImage format)
			if (presignedData.data && presignedData.data.uploadImage) {
				presignedData = presignedData.data.uploadImage;
			}
			
			// Validate required fields
			if (!presignedData.url || !presignedData.fields) {
				throw new Error('Missing required fields: url and fields');
			}
		} catch (err) {
			showStatus(`Invalid JSON: ${err.message}`, 'error');
			return;
		}

		// Disable button and show loading state
		submitBtn.disabled = true;
		btnText.style.display = 'none';
		btnSpinner.style.display = 'inline';
		showStatus('Capturing frame...', 'info');

		try {
			// Capture the current frame from the video
			const frameBlob = await captureFrame();
			
			showStatus('Uploading to S3...', 'info');

			// Parse fields (it might be a string or object)
			let fields;
			if (typeof presignedData.fields === 'string') {
				fields = JSON.parse(presignedData.fields);
			} else {
				fields = presignedData.fields;
			}

			console.log('Presigned URL:', presignedData.url);
			console.log('Fields:', fields);

			// Create FormData with all the fields
			const formData = new FormData();
			
			// Add all the presigned fields first (order matters for S3)
			// Add fields in the order they appear in the policy
			const fieldOrder = [
				'Content-Type',
				'x-amz-meta-upload_type',
				'bucket',
				'X-Amz-Algorithm',
				'X-Amz-Credential',
				'X-Amz-Date',
				'X-Amz-Security-Token',
				'key',
				'Policy',
				'X-Amz-Signature'
			];
			
			// Add fields in order if they exist
			for (const fieldName of fieldOrder) {
				if (fields[fieldName] !== undefined) {
					formData.append(fieldName, fields[fieldName]);
				}
			}
			
			// Add any remaining fields not in the order list
			for (const [key, value] of Object.entries(fields)) {
				if (!fieldOrder.includes(key)) {
					formData.append(key, value);
				}
			}
			
			// Add the file last (MUST be last for S3)
			formData.append('file', frameBlob, 'frame.png');

			console.log('Uploading to:', presignedData.url);

			// Upload to presigned URL using POST
			const uploadResponse = await fetch(presignedData.url, {
				method: 'POST',
				body: formData
			});

			console.log('Upload response status:', uploadResponse.status);

			if (!uploadResponse.ok) {
				const responseText = await uploadResponse.text();
				console.error('Upload error response:', responseText);
				throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
			}

			const uploadId = presignedData.uploadId || 'unknown';
			showStatus(`✓ Frame captured at ${video.currentTime.toFixed(2)}s and uploaded successfully! Upload ID: ${uploadId}`, 'success');
			
		} catch (err) {
			console.error('Upload error:', err);
			showStatus(`✗ Error: ${err.message}`, 'error');
		} finally {
			// Re-enable button and restore normal state
			submitBtn.disabled = false;
			btnText.style.display = 'inline';
			btnSpinner.style.display = 'none';
		}
	});

	/**
	 * Captures the current frame from the video element as a PNG blob
	 * @returns {Promise<Blob>} The captured frame as a PNG blob
	 */
	async function captureFrame() {
		return new Promise((resolve, reject) => {
			try {
				// Set canvas dimensions to match video
				canvas.width = video.videoWidth;
				canvas.height = video.videoHeight;

				// Draw the current video frame to canvas
				const ctx = canvas.getContext('2d');
				ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

				// Convert canvas to blob
				canvas.toBlob((blob) => {
					if (blob) {
						resolve(blob);
					} else {
						reject(new Error('Failed to capture frame'));
					}
				}, 'image/png');
			} catch (err) {
				reject(err);
			}
		});
	}

	/**
	 * Display a status message to the user
	 * @param {string} message - The message to display
	 * @param {string} type - The type of message: 'success', 'error', or 'info'
	 */
	function showStatus(message, type) {
		statusMessage.textContent = message;
		statusMessage.className = `status-message ${type}`;
	}
});

