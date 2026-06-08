// ====== 【自動更新検知ロジック】ここから ======
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => {
        console.log('Service Worker 登録成功');

        if (reg.waiting) {
          showUpdateBanner(reg.waiting);
        }

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBanner(newWorker);
            }
          });
        });
      })
      .catch(err => console.error('Service Worker 登録失敗:', err));
  });

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
      refreshing = true;
      window.location.reload();
    }
  });
}

function showUpdateBanner(worker) {
  if (document.getElementById('pwa-update-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'pwa-update-banner';
  banner.innerHTML = `
    <div style="position: fixed; top: 0; left: 0; width: 100%; background: #2b579a; color: white; text-align: center; padding: 12px; z-index: 9999; box-shadow: 0 2px 10px rgba(0,0,0,0.3); font-family: sans-serif; font-size: 14px;">
      アプリの新しいバージョンがあります。
      <button id="pwa-update-btn" style="background: #ffffff; color: #2b579a; border: none; padding: 6px 12px; margin-left: 10px; font-weight: bold; border-radius: 4px; cursor: pointer;">
        今すぐ更新
      </button>
    </div>
  `;
  document.body.appendChild(banner);

  document.getElementById('pwa-update-btn').addEventListener('click', async () => {
    // 古い IndexedDB モデルデータを全て削除
    if (window.indexedDB) {
      try {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name.includes('model') || db.name.includes('tensorflowjs')) {
            indexedDB.deleteDatabase(db.name);
            console.log(`IndexedDB削除: ${db.name}`);
          }
        }
      } catch (e) {
        console.error('IndexedDB削除エラー:', e);
      }
    }

    // Service Worker のキャッシュストレージをクリア
    if ('caches' in window) {
      try {
        const cacheNames = await caches.keys();
        for (const name of cacheNames) {
          await caches.delete(name);
          console.log(`キャッシュ削除: ${name}`);
        }
      } catch (e) {
        console.error('キャッシュ削除エラー:', e);
      }
    }

    worker.postMessage({ action: 'skipWaiting' });
  });
}
// ====== 【自動更新検知ロジック】ここまで ======

tf.env().set('WEBGL_PACK', true);

window.addEventListener('DOMContentLoaded', () => {
  const modelSelect = document.getElementById('modelSelect');
  const imageInput = document.getElementById('imageInput');
  const runBtn = document.getElementById('runBtn');
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const resultDiv = document.getElementById('result');

  const startCameraBtn = document.getElementById('startCameraBtn');
  const captureBtn = document.getElementById('captureBtn');
  const video = document.getElementById('video');

  const confSlider = document.getElementById('confSlider');
  const sliderValue = document.getElementById('sliderValue');

  let model = null;
  let imgElement = null;
  let stream = null;
  let lastInferenceRawData = null;

  imageInput.addEventListener('change', (evt) => {
    const file = evt.target.files[0];
    if (!file) return;
    
    stopCamera();
    lastInferenceRawData = null; 

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        imgElement = img;
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
        runBtn.disabled = !(model && imgElement);
        resultDiv.textContent = '画像が読み込まれました。「カウント開始」を押してください。';
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });

  startCameraBtn.addEventListener('click', async () => {
    if (stream) {
      stopCamera();
      return;
    }

    imgElement = null;
    runBtn.disabled = true;
    imageInput.value = ''; 
    lastInferenceRawData = null;

    canvas.width = 0;
    canvas.height = 0;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      video.srcObject = stream;
      video.style.display = 'block';
      startCameraBtn.textContent = '❌ カメラを閉じる';
      captureBtn.disabled = false;
      resultDiv.textContent = 'カメラが起動しました。対象を映して「写真を撮る」を押してください。';
    } catch (error) {
      console.error('カメラ起動エラー:', error);
      resultDiv.textContent = 'カメラの起動に失敗しました。アクセス権限を確認してください。';
    }
  });

  captureBtn.addEventListener('click', () => {
    if (!stream) return;

    let videoWidth = video.videoWidth;
    let videoHeight = video.videoHeight;
    
    const MAX_RESOLUTION = 1280;
    if (videoWidth > MAX_RESOLUTION) {
      const aspectRatio = videoHeight / videoWidth;
      videoWidth = MAX_RESOLUTION;
      videoHeight = Math.floor(MAX_RESOLUTION * aspectRatio);
    }
    
    canvas.width = videoWidth;
    canvas.height = videoHeight;
    ctx.drawImage(video, 0, 0, videoWidth, videoHeight);

    const img = new Image();
    img.src = canvas.toDataURL('image/jpeg');
    img.onload = () => {
      imgElement = img;
      runBtn.disabled = !(model && imgElement);
      resultDiv.textContent = '写真を撮影しました。「カウント開始」を押してください。';
      stopCamera();
    };
  });

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
    video.srcObject = null;
    video.style.display = 'none';
    startCameraBtn.textContent = '📸 カメラを起動';
    captureBtn.disabled = true;
  }

  // 🔑 改良版：バージョン文字列でキャッシュ判定
  async function loadModelFromFolder(folderPath, modelVersion) {
    if (!folderPath.endsWith('/')) folderPath += '/';
    
    resultDiv.textContent = 'モデルのセットアップ中...';
    runBtn.disabled = true;
    lastInferenceRawData = null;

    await tf.nextFrame();

    try {
      // 🔑 バージョン文字列を URL に付加（ただし、一度読み込まれたら同じ URL は再利用）
      const modelJsonUrl = `${folderPath}model.json?v=${modelVersion}`;
      
      model = await tf.loadGraphModel(modelJsonUrl, {
        fetchFunc: async (url, options) => {
          const response = await fetch(url, {
            ...options,
            cache: 'default' // 🔑 デフォルトキャッシュ動作に戻す
          });
          
          // .gz ファイルの自動解凍
          if (url.includes('.gz')) {
            console.log(`[pako] 圧縮ファイルを自動解凍中: ${url}`);
            const arrayBuffer = await response.arrayBuffer();
            const decompressed = pako.ungzip(new Uint8Array(arrayBuffer));
            return new Response(decompressed, {
              headers: new Headers({ 'Content-Type': 'application/octet-stream' })
            });
          }
          return response;
        }
      });

      tf.tidy(() => {
        const dummyInput = tf.zeros([1, 640, 640, 3]);
        model.execute(dummyInput);
      });
      resultDiv.textContent = 'モデル準備完了';
    } catch (error) {
      console.error(error);
      resultDiv.textContent = `モデルの読み込みに失敗しました: ${error.message}`;
      model = null;
    }
    runBtn.disabled = !(model && imgElement);
  }

  // 🔑 改良版：models_list.json を毎回確認（cache: no-store）
  async function loadModelList() {
    try {
      // 【重要】models_list.json は毎回ネットワークから確認（typo箇所を修正）
      const response = await fetch('models_list.json', { cache: 'no-store' });
      const modelList = await response.json();
      
      modelSelect.innerHTML = '';
      modelList.forEach(m => {
        const option = document.createElement('option');
        option.value = JSON.stringify({ path: m.path, version: m.version });
        option.textContent = m.name;
        modelSelect.appendChild(option);
      });
      
      if (modelList.length > 0) {
        const firstModel = modelList[0];
        await loadModelFromFolder(firstModel.path, firstModel.version);
      }
    } catch (error) {
      console.error(error);
      resultDiv.textContent = 'モデル一覧の読み込みに失敗しました';
    }
  }

  modelSelect.addEventListener('change', async () => {
    const selected = JSON.parse(modelSelect.value);
    await loadModelFromFolder(selected.path, selected.version);
  });

  async function runInference() {
    if (!model || !imgElement) {
      alert('モデルまたは画像がありません。');
      return;
    }

    resultDiv.textContent = 'カウント中... 🚀';
    runBtn.disabled = true;
    await tf.nextFrame();

    const modelWidth = 640;
    const modelHeight = 640;
    const origWidth = imgElement.width;
    const origHeight = imgElement.height;

    const scale = Math.min(modelWidth / origWidth, modelHeight / origHeight);
    const nw = Math.floor(origWidth * scale);
    const nh = Math.floor(origHeight * scale);

    const padTop = Math.floor((modelHeight - nh) / 2);
    const padLeft = Math.floor((modelWidth - nw) / 2);

    let inputTensor = tf.browser.fromPixels(imgElement).toFloat();
    let resized = tf.image.resizeBilinear(inputTensor, [nh, nw]);
    let padded = resized.pad([[padTop, modelHeight - nh - padTop], [padLeft, modelWidth - nw - padLeft], [0, 0]]);
    let expanded = padded.expandDims(0);
    let normalized = expanded.div(255.0);

    try {
      const outputTensor = await model.executeAsync(normalized);
      let rawOutput = Array.isArray(outputTensor) ? outputTensor[0] : outputTensor;

      const squeezed = rawOutput.squeeze();
      const transposed = squeezed.transpose([1, 0]);
      const data = await transposed.data();
      const shape = transposed.shape;

      lastInferenceRawData = {
        data: data,
        numBoxes: shape[0],
        numAttributes: shape[1],
        numClasses: shape[1] - 4,
        scale: scale,
        padTop: padTop,
        padLeft: padLeft
      };

      if (Array.isArray(outputTensor)) {
        outputTensor.forEach(t => t.dispose());
      } else {
        outputTensor.dispose();
      }
      squeezed.dispose();
      transposed.dispose();
      tf.dispose([inputTensor, resized, padded, expanded, normalized]);

      await refreshBBoxes();
      runBtn.disabled = false;

    } catch (error) {
      console.error(error);
      resultDiv.textContent = `エラー: ${error.message}`;
      tf.dispose([inputTensor, resized, padded, expanded, normalized]);
      runBtn.disabled = false;
    }
  }

  async function refreshBBoxes() {
    if (!imgElement || !lastInferenceRawData) return;

    const currentConf = parseFloat(confSlider.value);
    const { data, numBoxes, numAttributes, numClasses, scale, padTop, padLeft } = lastInferenceRawData;

    const boxes = [];
    const scores = [];

    for (let i = 0; i < numBoxes; i++) {
      const offset = i * numAttributes;
      const cx = data[offset];
      const cy = data[offset + 1];
      const w = data[offset + 2];
      const h = data[offset + 3];

      let maxScore = 0;
      for (let c = 0; c < numClasses; c++) {
        const score = data[offset + 4 + c];
        if (score > maxScore) maxScore = score;
      }

      if (maxScore >= currentConf) {
        const ymin = cy - h / 2;
        const xmin = cx - w / 2;
        const ymax = cy + h / 2;
        const xmax = cx + w / 2;

        boxes.push([ymin, xmin, ymax, xmax]);
        scores.push(maxScore);
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(imgElement, 0, 0);

    let count = 0;

    if (boxes.length > 0) {
      const boxesTensor = tf.tensor2d(boxes);
      const scoresTensor = tf.tensor1d(scores);
      
      const nmsIndices = await tf.image.nonMaxSuppressionAsync(
        boxesTensor,
        scoresTensor,
        100,
        0.45,
        currentConf
      );

      const indices = await nmsIndices.data();

      ctx.lineWidth = 2;
      ctx.strokeStyle = 'red';

      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const [ymin, xmin, ymax, xmax] = boxes[idx];

        count++;

        const realXmin = (xmin - padLeft) / scale;
        const realYmin = (ymin - padTop) / scale;
        const realXmax = (xmax - padLeft) / scale;
        const realYmax = (ymax - padTop) / scale;

        const boxWidth = realXmax - realXmin;
        const boxHeight = realYmax - realYmin;

        if (boxWidth > 0 && boxHeight > 0) {
          ctx.strokeRect(realXmin, realYmin, boxWidth, boxHeight);
        }
      }

      tf.dispose([boxesTensor, scoresTensor, nmsIndices]);
    }

    resultDiv.textContent = `検出数: ${count}`;
  }

  confSlider.addEventListener('input', (evt) => {
    sliderValue.textContent = parseFloat(evt.target.value).toFixed(2);
    refreshBBoxes();
  });

  runBtn.addEventListener('click', runInference);
  
  loadModelList();
});
