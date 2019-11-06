import SDBaseElement from './sd-base.js';
import Texture from './Texture.js';

const CAMERA = 'camera';
const IMAGE = 'image';
const VIDEO = 'video';

const REPEAT = 0x2901;
const CLAMP_TO_EDGE = 0x812f;
const MIRRORED_REPEAT = 0x8370;

const NEAREST = 0x2600;
const LINEAR = 0x2601;
const NEAREST_MIPMAP_NEAREST = 0x2700;
const LINEAR_MIPMAP_NEAREST = 0x2701;
const NEAREST_MIPMAP_LINEAR = 0x2702;
const LINEAR_MIPMAP_LINEAR = 0x2703;

const MAG_OPTIONS = {
  NEAREST,
  LINEAR,
};

const MIN_OPTIONS = {
  ...MAG_OPTIONS,
  NEAREST_MIPMAP_NEAREST,
  LINEAR_MIPMAP_NEAREST,
  NEAREST_MIPMAP_LINEAR,
  LINEAR_MIPMAP_LINEAR,
};

const WRAP_OPTIONS = {
  REPEAT,
  MIRRORED_REPEAT,
  CLAMP_TO_EDGE,
};

const IMG_REG = /(\.jpg|\.jpeg|\.png|\.gif|\.bmp)$/i;
const isImage = s => IMG_REG.test(s);
const VID_REG = /(\.mp4|\.3gp|\.webm|\.ogv)$/i;
const isVideo = s => VID_REG.test(s);

const floorPowerOfTwo = value => 2 ** Math.floor(Math.log(value) / Math.LN2);
const isPow2 = value => !(value & (value - 1)) && !!value;

const UNNAMED_TEXTURE_PREFIX = 'u_texture';

let unnamedTextureIndex = 0;

class TextureElement extends SDBaseElement {
  static get observedAttributes() {
    return ['mag-filter', 'min-filter', 'name', 'src', 'wrap-s', 'wrap-t'];
  }

  constructor() {
    super();
    this._imageOnload = this._imageOnload.bind(this);
  }

  disconnectedCallback() {
    // DELETE TEXTURE
  }

  get magFilter() {
    return MAG_OPTIONS[this.getAttribute('mag-filter')] || LINEAR;
  }

  get minFilter() {
    return MIN_OPTIONS[this.getAttribute('min-filter')] || LINEAR_MIPMAP_LINEAR;
  }

  get name() {
    return this.getAttribute('name');
  }

  set name(val) {
    this.setAttribute('name', val);
  }

  get shouldUpdate() {
    return (
      (this.type === CAMERA || this.type === VIDEO) &&
      this._source instanceof HTMLVideoElement &&
      this._source.readyState === this._source.HAVE_ENOUGH_DATA
    );
  }

  get src() {
    return this.getAttribute('src');
  }

  set src(val) {
    this.setAttribute('src', val);
  }

  get webcam() {
    return this.hasAttribute('webcam');
  }

  set webcam(cam) {
    if (cam) {
      this.setAttribute('webcam', '');
    } else {
      this.removeAttribute('webcam');
    }
  }

  get wrapS() {
    return WRAP_OPTIONS[this.getAttribute('wrap-s')] || REPEAT;
  }

  get wrapT() {
    return WRAP_OPTIONS[this.getAttribute('wrap-t')] || REPEAT;
  }

  init() {
    const { gl, program } = this._sd;

    if (!this.name) {
      this.name = `${UNNAMED_TEXTURE_PREFIX}${unnamedTextureIndex++}`;
    }

    this._location = gl.getUniformLocation(program, this.name);
    this._texture = new Texture(gl);

    if (!this.src && !this.webcam) return;

    if (this.webcam) {
      this._setupCamera();
    } else if (isVideo(this.src)) {
      this._setupVideo();
    } else if (isImage(this.src)) {
      this._setupImage();
    } else {
      this._setupCanvasImage();
    }
  }

  update() {
    this._texture.toUniform(
      this._location,
      this.shouldUpdate ? { pixels: this._source } : null
    );
  }

  _setupCanvasImage() {
    const canvas = document.querySelector(this.src);
    if (canvas instanceof HTMLCanvasElement) {
      this.src = canvas.toDataURL();
      this._setupImage();
    }
  }

  _setupImage() {
    this.type = IMAGE;
    this._source = new Image();
    this._source.crossOrigin = 'anonymous';
    this._source.onload = this._imageOnload;
    this._source.onerror = () => {
      console.warn(`failed loading src: ${this.src}`);
    };
    this._source.src = this.src;
  }

  _imageOnload() {
    const { _source: img } = this;
    const { gl } = this._sd;
    if (
      !gl ||
      !img ||
      !(
        img instanceof HTMLImageElement ||
        img instanceof HTMLCanvasElement ||
        img instanceof ImageBitmap
      )
    ) {
      return;
    }

    let isPowerOf2 = isPow2(img.width) && isPow2(img.height);
    const needsPowerOfTwo =
      this.wrapS !== CLAMP_TO_EDGE ||
      this.wrapT !== CLAMP_TO_EDGE ||
      (this.minFilter !== NEAREST && this.minFilter !== LINEAR);

    if (needsPowerOfTwo && isPowerOf2 === false) {
      this.pow2canvas = this.pow2canvas || document.createElement('canvas');
      this.pow2canvas.width = floorPowerOfTwo(img.width);
      this.pow2canvas.height = floorPowerOfTwo(img.height);

      const ctx = this.pow2canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, this.pow2canvas.width, this.pow2canvas.height);

      console.warn(
        `Image is not power of two ${img.width} x ${img.height}. Resized to ${
          this.pow2canvas.width
        } x ${this.pow2canvas.height};`
      );

      this._source = this.pow2canvas;
      isPowerOf2 = true;
    }

    this._texture.update({ pixels: this._source });

    if (isPowerOf2 && this.minFilter !== NEAREST && this.minFilter !== LINEAR) {
      gl.generateMipmap(gl.TEXTURE_2D);
    }

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, this.wrapS);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, this.wrapT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, this.minFilter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, this.magFilter);
  }

  _setupVideo() {
    const { gl } = this._sd;
    if (!gl) return;

    this.type = VIDEO;
    this._source = document.createElement('video');

    this._source.autoplay = true;
    this._source.muted = true;
    this._source.loop = true;
    this._source.playsInline = true;
    this._source.crossOrigin = 'anonymous';
    this._source.src = this.src;

    const wrapper = document.createElement('div');
    wrapper.style.width = wrapper.style.height = '1px';
    wrapper.style.overflow = 'hidden';
    wrapper.style.position = 'absolute';
    wrapper.style.opacity = '0';
    wrapper.style.pointerEvents = 'none';
    wrapper.style.zIndex = '-1000';
    wrapper.appendChild(this._source);
    document.body.appendChild(wrapper);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

    this._source.play();
  }

  _setupCamera() {
    const { gl } = this._sd;
    if (!gl) return;

    this.type = CAMERA;
    const getUserMedia =
      navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia;

    const start = stream => {
      this._source = document.createElement('video');
      this._source.width = 320;
      this._source.height = 240;
      this._source.autoplay = true;
      this._source.srcObject = stream;

      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    };

    const init = () => {
      navigator.mediaDevices
        .getUserMedia({ video: true })
        .then(start)
        .catch(e => console.log(e.name + ': ' + e.message));
    };

    const initLegacy = () => {
      getUserMedia({ video: true }, start, e => e);
    };

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      init();
    } else if (getUserMedia) {
      initLegacy();
    }
  }
}

if (!customElements.get('sd-texture')) {
  customElements.define('sd-texture', TextureElement);
}

export default TextureElement;
