import 'package:card_display/src/models/card_record.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('CardRecord JSON round trip preserves private-library metadata', () {
    final timestamp = DateTime.utc(2026, 10, 17, 9, 0);
    final record = CardRecord(
      id: 'record-1',
      game: GameKind.mtg,
      name: 'Test Card',
      typeLine: 'Creature — Test',
      rulesText: 'Test rules.',
      imageId: 'image-1',
      createdAt: timestamp,
      updatedAt: timestamp,
      isCopy: true,
      sourceCardName: 'Copy Source',
    );

    final restored = CardRecord.fromJson(record.toJson());

    expect(restored.name, record.name);
    expect(restored.game, GameKind.mtg);
    expect(restored.imageId, record.imageId);
    expect(restored.isCopy, isTrue);
    expect(restored.sourceCardName, 'Copy Source');
  });
}
