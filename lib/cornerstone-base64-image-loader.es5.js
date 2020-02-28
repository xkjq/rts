/*! *****************************************************************************
Copyright (c) Microsoft Corporation. All rights reserved.
Licensed under the Apache License, Version 2.0 (the "License"); you may not use
this file except in compliance with the License. You may obtain a copy of the
License at http://www.apache.org/licenses/LICENSE-2.0

THIS CODE IS PROVIDED ON AN *AS IS* BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, EITHER EXPRESS OR IMPLIED, INCLUDING WITHOUT LIMITATION ANY IMPLIED
WARRANTIES OR CONDITIONS OF TITLE, FITNESS FOR A PARTICULAR PURPOSE,
MERCHANTABLITY OR NON-INFRINGEMENT.

See the Apache Version 2.0 License for specific language governing permissions
and limitations under the License.
***************************************************************************** */

var __assign = function() {
    __assign = Object.assign || function __assign(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p)) t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};

var _defaultOptions = {
    channel: 4,
    width: null,
    height: null,
    schema: 'base64://'
};

var CornerstoneBase64ImageLoader = /** @class */ (function () {
    function CornerstoneBase64ImageLoader(cornerstone, options) {
        if (options === void 0) { options = _defaultOptions; }
        this._cornerstone = cornerstone;
        this._options = options;
        this._lastImageIdDrawn = null;
        this._UPNG = null;
        this._canvas = document.createElement('canvas');
        this.arrayBufferToImage = this.arrayBufferToImage.bind(this);
        this.getArrayBuffer = this.getArrayBuffer.bind(this);
        this.decodeBase64 = this.decodeBase64.bind(this);
        this.createImage = this.createImage.bind(this);
        this.imageLoader = this.imageLoader.bind(this);
        this.replaceImage = this.replaceImage.bind(this);
    }
    CornerstoneBase64ImageLoader.prototype.arrayBufferToImage = function (arrayBuffer) {
        return new Promise(function (resolve, reject) {
            var image = new Image();
            var arrayBufferView = new Uint8Array(arrayBuffer);
            var blob = new Blob([arrayBufferView]);
            var urlCreator = window.URL || window.webkitURL;
            var imageUrl = urlCreator.createObjectURL(blob);
            image.src = imageUrl;
            image.onload = function () {
                urlCreator.revokeObjectURL(imageUrl);
                resolve(image);
            };
            image.onerror = function (error) {
                urlCreator.revokeObjectURL(imageUrl);
                reject(error);
            };
        });
    };
    CornerstoneBase64ImageLoader.prototype.getArrayBuffer = function (str) {
        var buf = new ArrayBuffer(str.length);
        var bufView = new Uint8Array(buf);
        Array.from(str).map(function (ch, idx) {
            bufView[idx] = ch.charCodeAt(0);
            return ch;
        });
        return bufView;
    };
    CornerstoneBase64ImageLoader.prototype.decodeBase64 = function (base64PixelData) {
        var pixelDataAsString = window.atob(base64PixelData);
        var arrayBuffer = this.getArrayBuffer(pixelDataAsString);
        return arrayBuffer;
    };
    CornerstoneBase64ImageLoader.prototype.createImage = function (image, imageId) {
        var _this = this;
        var rows = image.naturalHeight;
        var columns = image.naturalWidth;
        var getImageData = function () {
            var context;
            if (_this._lastImageIdDrawn === imageId) {
                context = _this._canvas.getContext('2d');
            }
            else {
                _this._canvas.height = image.naturalHeight;
                _this._canvas.width = image.naturalWidth;
                context = _this._canvas.getContext('2d');
                context.drawImage(image, 0, 0);
                _this._lastImageIdDrawn = imageId;
            }
            return context.getImageData(0, 0, image.naturalWidth, image.naturalHeight);
        };
        var getPixelData = function () {
            var imageData = getImageData();
            return imageData.data;
        };
        var getCanvas = function () {
            if (_this._lastImageIdDrawn === imageId) {
                return _this._canvas;
            }
            _this._canvas.height = image.naturalHeight;
            _this._canvas.width = image.naturalWidth;
            var context = _this._canvas.getContext('2d');
            context.drawImage(image, 0, 0);
            _this._lastImageIdDrawn = imageId;
            return _this._canvas;
        };
        var setLastImageIdDrawn = function (nextLastImageIdDrawn) {
            if (nextLastImageIdDrawn === void 0) { nextLastImageIdDrawn = null; }
            _this._lastImageIdDrawn = nextLastImageIdDrawn;
        };
        return {
            imageId: imageId,
            minPixelValue: 0,
            maxPixelValue: 255,
            slope: 1,
            intercept: 0,
            windowCenter: 128,
            windowWidth: 255,
            render: this.cornerstone.renderWebImage,
            getPixelData: getPixelData,
            getCanvas: getCanvas,
            getImage: function () { return image; },
            setLastImageIdDrawn: setLastImageIdDrawn,
            rows: rows,
            columns: columns,
            height: rows,
            width: columns,
            color: true,
            rgba: false,
            columnPixelSpacing: null,
            rowPixelSpacing: null,
            invert: false,
            sizeInBytes: rows * columns * this._options.channel
        };
    };
    CornerstoneBase64ImageLoader.prototype.imageLoader = function (imageId) {
        var _this = this;
        // const schema = imageId.split('://')[0]
        var base64PixelData = imageId.replace(this._options.schema, '');
        var arrayBuffer;
        if (this._options.width && this._options.height && this._UPNG) {
            var columns = this._options.width;
            var rows = this._options.height;
            arrayBuffer = new Uint8Array(columns * rows * this._options.channel);
            arrayBuffer = this._UPNG.encode([arrayBuffer.buffer], columns, rows, 0);
        }
        else {
            arrayBuffer = this.decodeBase64(base64PixelData);
        }
        var imagePromise = this.arrayBufferToImage(arrayBuffer);
        var promise = new Promise(function (resolve, reject) {
            imagePromise.then(function (image) {
                var imageObject = _this.createImage(image, imageId);
                resolve(imageObject);
            }, reject);
        });
        return {
            promise: promise
        };
    };
    CornerstoneBase64ImageLoader.prototype.replaceImage = function (layer, arrayBuffer) {
        var _this = this;
        if (!this._UPNG) {
            return null;
        }
        var png = this._UPNG.encode([arrayBuffer.buffer], layer.image.columns, layer.image.rows, 0);
        var imagePromise = this.arrayBufferToImage(png);
        return imagePromise.then(function (image) {
            layer.image = _this.createImage(image, layer.image.imageId);
        });
    };
    Object.defineProperty(CornerstoneBase64ImageLoader.prototype, "options", {
        get: function () {
            return __assign({}, this._options);
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(CornerstoneBase64ImageLoader.prototype, "cornerstone", {
        get: function () {
            return this._cornerstone;
        },
        enumerable: true,
        configurable: true
    });
    Object.defineProperty(CornerstoneBase64ImageLoader.prototype, "UPNG", {
        get: function () {
            return this._UPNG;
        },
        enumerable: true,
        configurable: true
    });
    CornerstoneBase64ImageLoader.prototype.setUPNG = function (UPNG) {
        this._UPNG = UPNG;
    };
    CornerstoneBase64ImageLoader.prototype.registerLoaders = function () {
        this.cornerstone.registerImageLoader('base64', this.imageLoader);
    };
    return CornerstoneBase64ImageLoader;
}());

var _imageLoader;
var _options = __assign({}, _defaultOptions);
var cornerstoneBase64ImageLoader = {
    external: {
        set cornerstone(cs) {
            _imageLoader = new CornerstoneBase64ImageLoader(cs, _options);
            _imageLoader.registerLoaders();
        },
        get cornerstone() {
            return _imageLoader.cornerstone;
        },
        get UPNG() {
            return _imageLoader.UPNG;
        },
        set UPNG(_UPNG) {
            _imageLoader.setUPNG(_UPNG);
        }
    },
    initOptions: function () {
        _options = __assign({}, _defaultOptions);
    },
    set options(newOptions) {
        _options = __assign({}, _options, newOptions);
    },
    get options() {
        return __assign({}, _options);
    },
    get imageLoader() {
        return _imageLoader;
    }
};

export default cornerstoneBase64ImageLoader;
//# sourceMappingURL=cornerstone-base64-image-loader.es5.js.map
