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

function fitToBounds(innerWidth, innerHeight, outerWidth, outerHeight) {
  const innerAspect = innerWidth / innerHeight;
  const outerAspect = outerWidth / outerHeight;

  let targetWidth, targetHeight;
  if (innerAspect > outerAspect) {
    // Image is wider than the container
    targetWidth = outerWidth;
    targetHeight = outerWidth / innerAspect;
  } else {
    // Image is taller than the container
    targetHeight = outerHeight;
    targetWidth = outerHeight * innerAspect;
  }

  return { targetWidth, targetHeight };
}


function loadImage(url) {
  const img = new Image();
  img.onload = function () {
    originalImage = { img }; // Save the uploaded image

    const canvas = document.getElementById("overlayCanvas");
    const video = document.getElementById("videoFeed");

    // Determine canvas dimensions
    if (video.videoWidth && video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    } else {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    // Redraw the canvas with the loaded image
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

  // Calculate the target dimensions for the image
  const { targetWidth, targetHeight } = fitToBounds(
    img.width,
    img.height,
    canvas.width,
    canvas.height
  );

  // Compute the offsets to center the image
  const offsetX = (canvas.width - targetWidth) / 2;
  const offsetY = (canvas.height - targetHeight) / 2;

  // Draw the scaled and centered image
  ctx.globalAlpha = transparency;
  ctx.drawImage(img, offsetX, offsetY, targetWidth, targetHeight);

  if (alphaMask) {
    const imageData = ctx.getImageData(offsetX, offsetY, targetWidth, targetHeight);
    const data = imageData.data;

    for (let i = 0; i < data.length; i += 4) {
      const grayscale = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
      data[i] = 0; // R
      data[i + 1] = 0; // G
      data[i + 2] = 0; // B
      data[i + 3] = (255 - grayscale) * transparency;
    }

    ctx.putImageData(imageData, offsetX, offsetY);
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
  const canvas = document.getElementById("overlayCanvas");

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

      // Sync canvas dimensions with the video feed
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Redraw overlay to fit within the resized canvas
      updateCanvas();
    });
  } catch (error) {
    console.error("Error accessing the camera", error);

    if (error.name === "OverconstrainedError") {
      const fallbackConstraints = { video: { facingMode: "user" } };
      try {
        const stream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
        video.srcObject = stream;
        video.addEventListener("loadedmetadata", () => {
          video.play();
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          updateCanvas();
        });
        alert("Using the front camera because the rear camera is not available.");
      } catch (fallbackError) {
        alert("Could not access any camera. Please check your device and permissions.");
      }
    } else {
      alert("An error occurred accessing the camera.");
    }
  }
}