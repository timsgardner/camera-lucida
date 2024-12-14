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
    originalImage = { img }; // Save the uploaded image

    const canvas = document.getElementById("overlayCanvas");

    // Set the canvas dimensions to match the uploaded image
    canvas.width = img.width;
    canvas.height = img.height;

    // Redraw the overlay with the uploaded image
    updateCanvas();
  };
  img.src = url;
}



function updateCanvas() {
  const transparency = parseFloat(document.getElementById("transparencySlider").value);
  const invert = document.getElementById("invertColorsToggle").checked;
  const alphaMask = document.getElementById("alphaMaskToggle").checked;

  const canvas = document.getElementById("overlayCanvas");
  const ctx = canvas.getContext("2d");

  if (!originalImage) return; // No image loaded yet

  // Clear the canvas
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { img } = originalImage;

  // Draw the image at its original resolution
  ctx.globalAlpha = transparency;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  if (alphaMask) {
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const grayscale = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i] = 0; // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = (255 - grayscale) * transparency;
    }

    ctx.putImageData(imageData, 0, 0);
  } else if (invert) {
    canvas.style.filter = "invert(100%)";
  } else {
    canvas.style.filter = "none";
  }

  // Reset global alpha for future operations
  ctx.globalAlpha = 1.0;
}


async function setupCamera() {
  const video = document.getElementById("videoFeed");

  const constraints = {
    video: {
      facingMode: { ideal: "environment" }, // Prefer the rear camera
    },
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;

    video.addEventListener("loadedmetadata", () => {
      video.play();
      updateCanvas(); // Ensure the overlay is applied
    });
  } catch (error) {
    console.error("Error accessing the camera", error);
    alert("An error occurred accessing the camera. Please check your device and permissions.");
  }
}
