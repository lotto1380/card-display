import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

class OcrResult {
  const OcrResult({
    required this.name,
    required this.typeLine,
    required this.rulesText,
    required this.rawText,
  });

  final String name;
  final String typeLine;
  final String rulesText;
  final String rawText;
}

class OcrService {
  static const _typeWords = <String>[
    'creature',
    'artifact',
    'enchantment',
    'planeswalker',
    'instant',
    'sorcery',
    'land',
    'unit',
    'upgrade',
    'event',
  ];

  Future<OcrResult> read(String imagePath) async {
    final recognizer = TextRecognizer(script: TextRecognitionScript.latin);
    try {
      final result = await recognizer.processImage(InputImage.fromFilePath(imagePath));
      return _parse(result.text);
    } finally {
      await recognizer.close();
    }
  }

  OcrResult _parse(String rawText) {
    final lines = rawText
        .split(RegExp(r'[\r\n]+'))
        .map((line) => line.trim())
        .where((line) => line.length > 1)
        .toList();
    if (lines.isEmpty) {
      return const OcrResult(
        name: '',
        typeLine: '',
        rulesText: '',
        rawText: '',
      );
    }

    final name = lines.first;
    var typeIndex = -1;
    for (var index = 1; index < lines.length; index++) {
      final lower = lines[index].toLowerCase();
      if (_typeWords.any(lower.contains)) {
        typeIndex = index;
        break;
      }
    }
    final typeLine = typeIndex >= 0 ? lines[typeIndex] : '';
    final rulesStart = typeIndex >= 0 ? typeIndex + 1 : 1;
    final rules = lines.skip(rulesStart).where((line) {
      final lower = line.toLowerCase();
      return !RegExp(r'^\d+\s*/\s*\d+$').hasMatch(line) &&
          !lower.contains('©') &&
          !lower.startsWith('illus.');
    }).join('\n');

    return OcrResult(
      name: name,
      typeLine: typeLine,
      rulesText: rules,
      rawText: rawText,
    );
  }
}
