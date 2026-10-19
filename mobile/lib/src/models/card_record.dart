import 'dart:convert';

enum GameKind { mtg, swu, custom }

extension GameKindLabel on GameKind {
  String get label => switch (this) {
        GameKind.mtg => 'Magic: The Gathering',
        GameKind.swu => 'Star Wars: Unlimited',
        GameKind.custom => 'Custom Game',
      };

  String get shortLabel => switch (this) {
        GameKind.mtg => 'MTG',
        GameKind.swu => 'SWU',
        GameKind.custom => 'Custom',
      };
}

class CardRecord {
  const CardRecord({
    required this.id,
    required this.game,
    required this.name,
    required this.typeLine,
    required this.rulesText,
    required this.imageId,
    required this.createdAt,
    required this.updatedAt,
    this.isCopy = false,
    this.sourceCardName,
  });

  final String id;
  final GameKind game;
  final String name;
  final String typeLine;
  final String rulesText;
  final String imageId;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool isCopy;
  final String? sourceCardName;

  CardRecord copyWith({
    String? name,
    String? typeLine,
    String? rulesText,
    String? imageId,
    DateTime? updatedAt,
  }) {
    return CardRecord(
      id: id,
      game: game,
      name: name ?? this.name,
      typeLine: typeLine ?? this.typeLine,
      rulesText: rulesText ?? this.rulesText,
      imageId: imageId ?? this.imageId,
      createdAt: createdAt,
      updatedAt: updatedAt ?? this.updatedAt,
      isCopy: isCopy,
      sourceCardName: sourceCardName,
    );
  }

  Map<String, Object?> toJson() => {
        'id': id,
        'game': game.name,
        'name': name,
        'typeLine': typeLine,
        'rulesText': rulesText,
        'imageId': imageId,
        'createdAt': createdAt.toIso8601String(),
        'updatedAt': updatedAt.toIso8601String(),
        'isCopy': isCopy,
        'sourceCardName': sourceCardName,
      };

  factory CardRecord.fromJson(Map<String, Object?> json) {
    return CardRecord(
      id: json['id']! as String,
      game: GameKind.values.byName(json['game']! as String),
      name: json['name']! as String,
      typeLine: json['typeLine']! as String,
      rulesText: json['rulesText']! as String,
      imageId: json['imageId']! as String,
      createdAt: DateTime.parse(json['createdAt']! as String),
      updatedAt: DateTime.parse(json['updatedAt']! as String),
      isCopy: json['isCopy'] as bool? ?? false,
      sourceCardName: json['sourceCardName'] as String?,
    );
  }
}

class CardCorrection {
  const CardCorrection({
    required this.name,
    required this.typeLine,
    required this.rulesText,
  });

  final String name;
  final String typeLine;
  final String rulesText;

  String encode() => jsonEncode({
        'name': name,
        'typeLine': typeLine,
        'rulesText': rulesText,
      });

  factory CardCorrection.decode(String value) {
    final json = jsonDecode(value) as Map<String, dynamic>;
    return CardCorrection(
      name: json['name'] as String? ?? '',
      typeLine: json['typeLine'] as String? ?? '',
      rulesText: json['rulesText'] as String? ?? '',
    );
  }
}
