// アプリ起動時にService Workerを登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then(reg => console.log('Service Worker 登録成功:', reg))
      .catch(err => console.error('Service Worker 登録失敗:', err));
  });
}

// ⚠️ エラーの原因となった「WEBGL_FORCE_F16_TEXTUREACTIVATE」を削除し、
// お使いのバージョンでも確実に動く安全な最適化フラグのみに修正しました。
tf.env().set('WEBGL_PACK', true);

// 画面のすべての要素（HTML）が完全に読み込まれてから安全にプログラムをスタートさせる
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

  // スライダー要素の取得
  const confSlider = document.getElementById('confSlider');
  const sliderValue = document.getElementById('sliderValue');

  let model = null;
  let imgElement = null;
  let stream = null;

  // リアルタイム処理のために最新の推論生データを保持する変数
  let lastInferenceRawData = null;

  // フォルダから画像が選択された時の処理
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

  // カメラ起動ボタンの処理
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);

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

  // 写真を撮るボタンの処理
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

  // IndexedDB高速読み込み版
  async function loadModelFromFolder(folderPath) {
    if (!folderPath.endsWith('/')) folderPath += '/';
    
    const modelKey = folderPath.replace(/[^a-zA-Z0-9]/g, '_');
    const localIndexedDBPath = `indexeddb://${modelKey}`;

    resultDiv.textContent = 'モデルのセットアップ中...';
    runBtn.disabled = true;
    lastInferenceRawData = null;

    await tf.nextFrame();

    try {
      model = await tf.loadGraphModel(localIndexedDBPath);
      tf.tidy(() => {
        const dummyInput = tf.zeros([1, 640, 640, 3]);
        model.execute(dummyInput);
      });
      resultDiv.textContent = 'モデル準備完了（キャッシュから高速起動）';
    } catch (cacheError) {
      resultDiv.textContent = '初期設定中（初回のみ10秒ほどかかります）...';
      try {
        model = await tf.loadGraphModel(folderPath + "model.json");
        await model.save(localIndexedDBPath);
        tf.tidy(() => {
          const dummyInput = tf.zeros([1, 640, 640, 3]);
          model.execute(dummyInput);
        });
        resultDiv.textContent = 'モデル準備完了（ローカルに保存しました）';
      } catch (serverError) {
        console.error(serverError);
        resultDiv.textContent = 'モデルの読み込みに失敗しました';
        model = null;
      }
    }
    runBtn.disabled = !(model && imgElement);
  }

  // モデル一覧（json）を読み込んでセレクトボックスを生成する関数
  async function loadModelList() {
    try {
      const response = await fetch('models_list.json');
      const modelList = await response.json();
      modelSelect.innerHTML = '';
      modelList.forEach(m => {
        const option = document.createElement('option');
        option.value = m.path;
        option.textContent = m.name;
        modelSelect.appendChild(option);
      });
      if (modelList.length > 0) await loadModelFromFolder(modelSelect.value);
    } catch (error) {
      resultDiv.textContent = 'モデル一覧の読み込みに失敗しました';
    }
  }

  modelSelect.addEventListener('change', () => loadModelFromFolder(modelSelect.value));

  // 重たいAI推論の本体
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

  // スライダー調整時に一瞬で枠を上書きする関数
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

  // スライダーイベントの登録
  confSlider.addEventListener('input', (evt) => {
    sliderValue.textContent = parseFloat(evt.target.value).toFixed(2);
    refreshBBoxes();
  });

  runBtn.addEventListener('click', runInference);
  
  loadModelList();
});
