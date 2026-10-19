import 'dart:io';
import 'dart:typed_data';

import 'package:image/image.dart' as img;

class ImageQualityReport {
  const ImageQualityReport({
    required this.highlightRatio,
    required this.detailScore,
  });

  final double highlightRatio;
  final double detailScore;

  bool get hasGlare => highlightRatio > 0.035;
  bool get mayBeBlurry => detailScore < 12;

  List<String> get warnings => [
        if (hasGlare)
          'Strong glare detected. Remove the sleeve or change the camera angle.',
        if (mayBeBlurry)
          'The image may be blurry. Hold the phone steady and retake it.',
      ];
}

class ImageProcessor {
  static const outputWidth = 300;
  static const outputHeight = 400;

  Future<ImageQualityReport> inspectFile(String path) async {
    final source = img.decodeImage(await File(path).readAsBytes());
    if (source == null) throw const FormatException('The photo could not be read.');
    final image = img.copyResize(
      img.bakeOrientation(source),
      width: 240,
      interpolation: img.Interpolation.average,
    );
    var highlights = 0;
    var samples = 0;
    var detailTotal = 0.0;
    for (var y = 1; y < image.height - 1; y += 2) {
      for (var x = 1; x < image.width - 1; x += 2) {
        final pixel = image.getPixel(x, y);
        final luminance = _luminance(pixel.r, pixel.g, pixel.b);
        if (pixel.r > 245 && pixel.g > 245 && pixel.b > 245) highlights++;
        final next = image.getPixel(x + 1, y);
        detailTotal += (luminance - _luminance(next.r, next.g, next.b)).abs();
        samples++;
      }
    }
    return ImageQualityReport(
      highlightRatio: samples == 0 ? 0 : highlights / samples,
      detailScore: samples == 0 ? 0 : detailTotal / samples,
    );
  }

  Future<Uint8List> preparePhoto(String path) async {
    final source = img.decodeImage(await File(path).readAsBytes());
    if (source == null) throw const FormatException('The photo could not be read.');
    final oriented = img.bakeOrientation(source);
    final cropped = _centerCrop(oriented, 3 / 4);
    final resized = img.copyResize(
      cropped,
      width: outputWidth,
      height: outputHeight,
      interpolation: img.Interpolation.cubic,
    );
    return Uint8List.fromList(img.encodePng(_ditherToFourColors(resized)));
  }

  Uint8List buildTextOnlyCard({
    required String title,
    required String typeLine,
    required String rulesText,
    String? sourceCardName,
  }) {
    final canvas = img.Image(
      width: outputWidth,
      height: outputHeight,
      numChannels: 3,
      backgroundColor: img.ColorRgb8(255, 255, 255),
    );
    final black = img.ColorRgb8(0, 0, 0);
    final red = img.ColorRgb8(255, 0, 0);
    final yellow = img.ColorRgb8(255, 255, 0);
    img.fillRect(canvas, x1: 0, y1: 0, x2: 299, y2: 46, color: yellow);
    img.fillRect(canvas, x1: 0, y1: 47, x2: 299, y2: 51, color: red);
    img.drawRect(canvas, x1: 1, y1: 1, x2: 298, y2: 398, color: black, thickness: 3);
    img.drawString(
      canvas,
      _ellipsize(title, 25),
      font: img.arial24,
      x: 10,
      y: 10,
      color: black,
    );
    var y = 62;
    if (sourceCardName != null && sourceCardName.trim().isNotEmpty) {
      img.drawString(
        canvas,
        'Copied by: ${_ellipsize(sourceCardName, 31)}',
        font: img.arial14,
        x: 10,
        y: y,
        color: red,
      );
      y += 23;
    }
    for (final line in _wrap(typeLine, 38)) {
      img.drawString(canvas, line, font: img.arial14, x: 10, y: y, color: black);
      y += 18;
    }
    y += 7;
    img.drawLine(canvas, x1: 10, y1: y, x2: 289, y2: y, color: black, thickness: 2);
    y += 10;
    for (final line in _wrap(rulesText, 39)) {
      if (y > 376) break;
      img.drawString(canvas, line, font: img.arial14, x: 10, y: y, color: black);
      y += 18;
    }
    return Uint8List.fromList(img.encodePng(canvas));
  }

  img.Image _centerCrop(img.Image source, double targetRatio) {
    final sourceRatio = source.width / source.height;
    if (sourceRatio > targetRatio) {
      final width = (source.height * targetRatio).round();
      return img.copyCrop(
        source,
        x: (source.width - width) ~/ 2,
        y: 0,
        width: width,
        height: source.height,
      );
    }
    final height = (source.width / targetRatio).round();
    return img.copyCrop(
      source,
      x: 0,
      y: (source.height - height) ~/ 2,
      width: source.width,
      height: height,
    );
  }

  img.Image _ditherToFourColors(img.Image source) {
    const palette = <(double, double, double)>[
      (0, 0, 0),
      (255, 255, 255),
      (255, 0, 0),
      (255, 255, 0),
    ];
    final width = source.width;
    final height = source.height;
    final redError = List<double>.filled(width * height, 0);
    final greenError = List<double>.filled(width * height, 0);
    final blueError = List<double>.filled(width * height, 0);
    final output = img.Image(width: width, height: height, numChannels: 3);

    void spread(int x, int y, double er, double eg, double eb, double factor) {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      final index = y * width + x;
      redError[index] += er * factor;
      greenError[index] += eg * factor;
      blueError[index] += eb * factor;
    }

    for (var y = 0; y < height; y++) {
      for (var x = 0; x < width; x++) {
        final index = y * width + x;
        final pixel = source.getPixel(x, y);
        final r = (pixel.r + redError[index]).clamp(0, 255).toDouble();
        final g = (pixel.g + greenError[index]).clamp(0, 255).toDouble();
        final b = (pixel.b + blueError[index]).clamp(0, 255).toDouble();
        var nearest = palette.first;
        var bestDistance = double.infinity;
        for (final color in palette) {
          final distance = 0.30 * (r - color.$1) * (r - color.$1) +
              0.59 * (g - color.$2) * (g - color.$2) +
              0.11 * (b - color.$3) * (b - color.$3);
          if (distance < bestDistance) {
            bestDistance = distance;
            nearest = color;
          }
        }
        output.setPixelRgb(
          x,
          y,
          nearest.$1.toInt(),
          nearest.$2.toInt(),
          nearest.$3.toInt(),
        );
        final er = r - nearest.$1;
        final eg = g - nearest.$2;
        final eb = b - nearest.$3;
        spread(x + 1, y, er, eg, eb, 7 / 16);
        spread(x - 1, y + 1, er, eg, eb, 3 / 16);
        spread(x, y + 1, er, eg, eb, 5 / 16);
        spread(x + 1, y + 1, er, eg, eb, 1 / 16);
      }
    }
    return output;
  }

  static double _luminance(num r, num g, num b) =>
      0.2126 * r + 0.7152 * g + 0.0722 * b;

  static String _ellipsize(String value, int max) {
    final clean = value.trim();
    if (clean.length <= max) return clean;
    return '${clean.substring(0, max - 1)}…';
  }

  static List<String> _wrap(String value, int maxCharacters) {
    final output = <String>[];
    for (final paragraph in value.replaceAll('\r', '').split('\n')) {
      final words = paragraph.trim().split(RegExp(r'\s+'));
      var line = '';
      for (final word in words) {
        if (word.isEmpty) continue;
        final candidate = line.isEmpty ? word : '$line $word';
        if (candidate.length <= maxCharacters) {
          line = candidate;
        } else {
          if (line.isNotEmpty) output.add(line);
          line = word;
        }
      }
      if (line.isNotEmpty) output.add(line);
      if (paragraph.trim().isEmpty) output.add('');
    }
    return output;
  }
}
