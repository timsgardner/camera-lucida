export function setupCameraButton(video) {
  const startCameraButton = document.getElementById("startCameraButton");
  const cameraSelect = document.getElementById("cameraSelect");
  const cameraStatus = document.getElementById("cameraStatus");
  let currentStream = null;
  let isStarting = false;

  async function updateCameraList(activeDeviceId) {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoInputs = devices.filter(
      (device) => device.kind === "videoinput"
    );

    cameraSelect.replaceChildren();
    videoInputs.forEach((device, index) => {
      const option = document.createElement("option");
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      cameraSelect.appendChild(option);
    });

    cameraSelect.disabled = videoInputs.length === 0;
    if (activeDeviceId && videoInputs.some((device) => device.deviceId === activeDeviceId)) {
      cameraSelect.value = activeDeviceId;
    }
  }

  async function startCamera(deviceId = null) {
    if (isStarting) return;

    isStarting = true;
    startCameraButton.disabled = true;
    cameraStatus.textContent = "Requesting camera access...";

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera access is not available in this browser.");
      }

      if (currentStream) {
        currentStream.getTracks().forEach((track) => track.stop());
      }

      const videoConstraints = deviceId
        ? { deviceId: { exact: deviceId } }
        : { facingMode: { ideal: "environment" } };

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: videoConstraints,
          audio: false,
        });
      } catch (error) {
        if (deviceId || error.name !== "OverconstrainedError") {
          throw error;
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      currentStream = stream;
      video.srcObject = currentStream;
      const activeTrack = currentStream.getVideoTracks()[0];
      const activeDeviceId = activeTrack?.getSettings().deviceId;
      await updateCameraList(activeDeviceId);
      cameraStatus.textContent = "Camera active";

      await video.play();
    } catch (error) {
      cameraStatus.textContent = `Camera error: ${error.message}`;
      console.error("Error accessing camera:", error);
    } finally {
      isStarting = false;
      startCameraButton.disabled = false;
    }
  }

  cameraSelect.addEventListener("change", () => {
    if (cameraSelect.value) {
      startCamera(cameraSelect.value);
    }
  });

  startCameraButton.addEventListener("click", () => startCamera());
}

export function initializeVideo() {
  const video = document.createElement("video");
  video.autoplay = true;
  video.muted = true;
  video.playsInline = true;
  return video;
}
