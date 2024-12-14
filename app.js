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
  const transparency = document.getElementById("transparencySlider").value;
  const invert = document.getElementById("invertColorsToggle").checked;
  const alphaMask = document.getElementById("alphaMaskToggle").checked;

  const canvas = document.getElementById("overlayCanvas");
  const ctx = canvas.getContext("2d");

  if (!originalImage) return; // No image loaded yet

  // Clear the canvas and redraw the original image
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const { img, drawWidth, drawHeight, offsetX, offsetY } = originalImage;
  ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

  if (alphaMask) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // Apply inverse alpha mask
    for (let i = 0; i < data.length; i += 4) {
      const grayscale = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      const alpha = 255 - grayscale; // Inverse alpha
      data[i] = 0; // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = alpha; // Alpha
    }

    // Put the modified data back on the canvas
    ctx.putImageData(imageData, 0, 0);
  } else {
    // Default behavior for filters (grayscale, invert)
    const filter = `opacity(${transparency})${invert ? " invert(100%)" : ""}`;
    canvas.style.filter = filter;
  }
}



async function setupCamera() {
  const video = document.getElementById("videoFeed");

  const constraints = {
    video: {
      facingMode: { ideal: "environment" }, // Use 'ideal' instead of 'exact'
      // width: { ideal: 640 }, // Optional: Specify preferred resolution
      // height: { ideal: 480 } // Optional: Specify preferred resolution
    },
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    video.addEventListener("loadedmetadata", () => {
      video.play();
    });
  } catch (error) {
    console.error("Error accessing the camera", error);

    if (error.name === "OverconstrainedError") {
      console.warn("Could not find rear camera. Trying front camera...");
      // Attempt to get the front camera
      const fallbackConstraints = { video: { facingMode: "user" } };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        video.srcObject = stream;
        video.addEventListener("loadedmetadata", () => {
          video.play();
        });
        // Optionally inform the user that the front camera is being used.
        alert("Using the front camera because the rear camera is not available."); // or display a message in the UI
      } catch (fallbackError) {
        console.error("Error accessing front camera:", fallbackError);
        // Handle the case where neither camera is available.  e.g., show an error message to the user.
        alert("Could not access any camera. Please check your device and permissions.");
      }
    } else if (error.name === "NotAllowedError") {
      console.error("Camera permission denied.");
      alert("Please grant camera permissions to use this feature.");
    } else {
      // Handle other potential errors
      alert("An error occurred accessing the camera.");
    }
  }
}
