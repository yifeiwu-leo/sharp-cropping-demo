document.addEventListener('DOMContentLoaded', () => {
	const video = document.getElementById('videoPlayer');
	const canvas = document.getElementById('canvas');
	const form = document.getElementById('uploadForm');
	const presignedUrlInput = document.getElementById('presignedUrl');
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
		
		const presignedUrl = presignedUrlInput.value.trim();
		
		if (!presignedUrl) {
			showStatus('Please enter a presigned URL', 'error');
			return;
		}

		// Validate URL format
		try {
			new URL(presignedUrl);
		} catch (err) {
			showStatus('Invalid URL format', 'error');
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
			
			showStatus('Uploading to presigned URL...', 'info');

			// Create FormData for POST upload
			const formData = new FormData();
			formData.append('file', frameBlob, 'frame.png');

			// Upload to presigned URL using POST
			const uploadResponse = await fetch(presignedUrl, {
				method: 'POST',
				body: formData
			});

			if (!uploadResponse.ok) {
				throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
			}

			showStatus(`✓ Frame captured at ${video.currentTime.toFixed(2)}s and uploaded successfully!`, 'success');
			
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

