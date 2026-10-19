import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../models/card_record.dart';
import '../repositories/card_repository.dart';

class PrivateCardThumbnail extends StatelessWidget {
  const PrivateCardThumbnail({
    required this.record,
    required this.repository,
    super.key,
  });

  final CardRecord record;
  final CardRepository repository;

  @override
  Widget build(BuildContext context) {
    return FutureBuilder<Uint8List>(
      future: repository.imageBytes(record),
      builder: (context, snapshot) {
        if (snapshot.hasData) {
          return Image.memory(snapshot.data!, fit: BoxFit.cover, gaplessPlayback: true);
        }
        if (snapshot.hasError) {
          return const ColoredBox(
            color: Color(0xFFE9E9E9),
            child: Center(child: Icon(Icons.lock_outline)),
          );
        }
        return const ColoredBox(
          color: Color(0xFFF1F1F1),
          child: Center(child: CircularProgressIndicator()),
        );
      },
    );
  }
}
