import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:gal/gal.dart';
import 'package:path_provider/path_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../models/card_record.dart';
import '../services/secure_card_store.dart';

class CardRepository {
  CardRepository(this._store);

  static const _indexKey = 'card_records_v1';
  static const _correctionPrefix = 'correction_v1_';
  static const _uuid = Uuid();

  final SecureCardStore _store;

  Future<List<CardRecord>> all({GameKind? game}) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_indexKey);
    if (raw == null) return [];
    final records = (jsonDecode(raw) as List<dynamic>)
        .map((item) => CardRecord.fromJson(item as Map<String, Object?>))
        .where((item) => game == null || item.game == game)
        .toList()
      ..sort((a, b) => b.updatedAt.compareTo(a.updatedAt));
    return records;
  }

  Future<CardRecord> save({
    required GameKind game,
    required String name,
    required String typeLine,
    required String rulesText,
    required Uint8List processedPng,
    bool isCopy = false,
    String? sourceCardName,
  }) async {
    final now = DateTime.now();
    final id = _uuid.v4();
    final imageId = _uuid.v4();
    await _store.write(imageId, processedPng);
    final record = CardRecord(
      id: id,
      game: game,
      name: name.trim().isEmpty ? 'Untitled card' : name.trim(),
      typeLine: typeLine.trim(),
      rulesText: rulesText.trim(),
      imageId: imageId,
      createdAt: now,
      updatedAt: now,
      isCopy: isCopy,
      sourceCardName: sourceCardName,
    );
    final records = await all()..insert(0, record);
    await _writeIndex(records);
    return record;
  }

  Future<void> delete(CardRecord record) async {
    final records = await all()..removeWhere((item) => item.id == record.id);
    await _writeIndex(records);
    await _store.delete(record.imageId);
  }

  Future<Uint8List> imageBytes(CardRecord record) => _store.read(record.imageId);

  Future<void> exportToGallery(CardRecord record) async {
    if (!await Gal.hasAccess()) {
      await Gal.requestAccess();
    }
    final bytes = await imageBytes(record);
    final temporary = await getTemporaryDirectory();
    final safeName = record.name
        .replaceAll(RegExp(r'[^A-Za-z0-9_-]+'), '_')
        .replaceAll(RegExp(r'_+'), '_');
    final file = File('${temporary.path}/${safeName}_card_display.png');
    await file.writeAsBytes(bytes, flush: true);
    try {
      await Gal.putImage(file.path, album: 'Card Display');
    } finally {
      if (await file.exists()) await file.delete();
    }
  }

  Future<void> saveCorrection(
    GameKind game,
    String lookupName,
    CardCorrection correction,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _correctionKey(game, lookupName),
      correction.encode(),
    );
  }

  Future<CardCorrection?> correctionFor(
    GameKind game,
    String lookupName,
  ) async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_correctionKey(game, lookupName));
    return raw == null ? null : CardCorrection.decode(raw);
  }

  String _correctionKey(GameKind game, String name) {
    final normalized = name.trim().toLowerCase().replaceAll(RegExp(r'\s+'), ' ');
    return '$_correctionPrefix${game.name}_$normalized';
  }

  Future<void> _writeIndex(List<CardRecord> records) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(
      _indexKey,
      jsonEncode(records.map((record) => record.toJson()).toList()),
    );
  }
}
