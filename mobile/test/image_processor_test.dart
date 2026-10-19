import 'package:card_display/src/services/image_processor.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;

void main() {
  test('text-only output has exact device size and four-color palette', () {
    final bytes = ImageProcessor().buildTextOnlyCard(
      title: 'Copied Card',
      typeLine: 'Creature — Test',
      rulesText: 'This is editable game text.',
      sourceCardName: 'Copy Source',
    );
    final output = img.decodePng(bytes)!;

    expect(output.width, 300);
    expect(output.height, 400);
    for (final pixel in output) {
      final color = (pixel.r.toInt(), pixel.g.toInt(), pixel.b.toInt());
      expect(
        const {
          (0, 0, 0),
          (255, 255, 255),
          (255, 0, 0),
          (255, 255, 0),
        }.contains(color),
        isTrue,
      );
    }
  });
}
