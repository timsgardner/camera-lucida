console.log("hey there")

document.getElementById("imageInput").addEventListener("change", function (e) {
  if (e.target.files.length > 0) {
    const file = e.target.files[0];
    const url = URL.createObjectURL(file);
    loadImage(url);
  }
});

document
  .getElementById("transparencySlider")
  .addEventListener("input", updateCanvas);
document
  .getElementById("invertColorsToggle")
  .addEventListener("change", updateCanvas);
document
  .getElementById("alphaMaskToggle")
  .addEventListener("change", updateCanvas);


document
  .getElementById("startCameraButton")
  .addEventListener("click", function () {
    setupCamera();
    this.disabled = true; // Disable the button after starting the camera
  });

let originalImage = null; // Global variable to store the original image

function loadImage(url) {
  const img = new Image();
  img.onload = function () {
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate image dimensions to fit within the canvas without distortion
    const canvasAspect = canvas.width / canvas.height;
    const imageAspect = img.width / img.height;

    let drawWidth, drawHeight;
    if (imageAspect > canvasAspect) {
      drawWidth = canvas.width;
      drawHeight = canvas.width / imageAspect;
    } else {
      drawHeight = canvas.height;
      drawWidth = canvas.height * imageAspect;
    }

    // Center the image in the canvas
    const offsetX = (canvas.width - drawWidth) / 2;
    const offsetY = (canvas.height - drawHeight) / 2;

    // Draw the image onto the canvas
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    // Save the image as the original reference
    originalImage = { img, drawWidth, drawHeight, offsetX, offsetY };

    // Apply filters (transparency, invert colors, etc.)
    updateCanvas();
  };
  img.src = url;
}

function updateCanvas() {
  const transparency = parseFloat(document.getElementById("transparencySlider").value); // Parse as float
  const invert = document.getElementById("invertColorsToggle").checked;
  const alphaMask = document.getElementById("alphaMaskToggle").checked;

  const canvas = document.getElementById("overlayCanvas");
  const ctx = canvas.getContext("2d");

  if (!originalImage) return; // No image loaded yet

  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Redraw the original image
  const { img, drawWidth, drawHeight, offsetX, offsetY } = originalImage;
  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

  if (alphaMask) {
    // Get image data for alpha mask application
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      // Convert pixel to grayscale
      const grayscale = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

      // Set pixel to black and scale transparency by the slider value
      data[i] = 0; // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = (255 - grayscale) * transparency; // Alpha scaled by transparency
    }

    // Put the modified data back on the canvas
    ctx.putImageData(imageData, 0, 0);
  } else {
    // Apply standard filters using CSS
    const filter = `opacity(${transparency})${invert ? " invert(100%)" : ""}`;
    canvas.style.filter = filter;
  }
}






async function setupCamera() {
  const video = document.getElementById("videoFeed");
  const canvas = document.getElementById("overlayCanvas");

  const constraints = {
    video: {
      facingMode: { ideal: "environment" }, // Prefer the rear camera
    },
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;

    // Wait for video metadata to load before adjusting canvas
    video.addEventListener("loadedmetadata", () => {
      video.play();

      // Sync canvas dimensions with the video feed
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Redraw overlay to fit within the resized canvas
      updateCanvas();
    });
  } catch (error) {
    console.error("Error accessing the camera", error);

    if (error.name === "OverconstrainedError") {
      console.warn("Could not find rear camera. Trying front camera...");
      const fallbackConstraints = { video: { facingMode: "user" } };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        video.srcObject = stream;
        video.addEventListener("loadedmetadata", () => {
          video.play();

          // Sync canvas dimensions with the fallback video feed
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          // Redraw overlay
          updateCanvas();
        });

        alert("Using the front camera because the rear camera is not available.");
      } catch (fallbackError) {
        console.error("Error accessing front camera:", fallbackError);
        alert("Could not access any camera. Please check your device and permissions.");
      }
    } else if (error.name === "NotAllowedError") {
      console.error("Camera permission denied.");
      alert("Please grant camera permissions to use this feature.");
    } else {
      alert("An error occurred accessing the camera.");
    }
  }
}
