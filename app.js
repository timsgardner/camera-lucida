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
  .getElementById("startCameraButton")
  .addEventListener("click", function () {
    setupCamera();
    this.disabled = true; // Disable the button after starting the camera
  });

function loadImage(url) {
  const img = new Image();
  img.onload = function () {
    const canvas = document.getElementById("overlayCanvas");
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    updateCanvas();
  };
  img.src = url;
}

function updateCanvas() {
  const transparency = document.getElementById("transparencySlider").value;
  const invert = document.getElementById("invertColorsToggle").checked;
  const canvas = document.getElementById("overlayCanvas");
  const filter = `grayscale(100%) opacity(${transparency})${
    invert ? " invert(100%)" : ""
  }`;
  canvas.style.filter = filter;
}

async function setupCamera() {
  const video = document.getElementById("videoFeed"); // Reference existing video element

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    video.srcObject = stream;
    video.addEventListener("loadedmetadata", () => {
      video.play();
    });
  } catch (error) {
    console.error("Error accessing the camera", error);
  }
}
