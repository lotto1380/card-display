import 'card_record.dart';

class CaptureDraft {
  const CaptureDraft({
    required this.game,
    required this.photoPath,
    required this.name,
    required this.typeLine,
    required this.rulesText,
    required this.rawOcr,
  });

  final GameKind game;
  final String photoPath;
  final String name;
  final String typeLine;
  final String rulesText;
  final String rawOcr;
}
