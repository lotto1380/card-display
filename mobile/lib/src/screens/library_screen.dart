import 'dart:io';

import 'package:flutter/material.dart';

import '../models/capture_draft.dart';
import '../models/card_record.dart';
import '../repositories/card_repository.dart';
import '../services/image_processor.dart';
import '../services/ocr_service.dart';
import '../widgets/private_card_thumbnail.dart';
import 'capture_screen.dart';
import 'copy_card_screen.dart';
import 'draft_review_screen.dart';
import 'final_card_screen.dart';

class LibraryScreen extends StatefulWidget {
  const LibraryScreen({
    required this.game,
    required this.repository,
    required this.imageProcessor,
    required this.ocrService,
    super.key,
  });

  final GameKind game;
  final CardRepository repository;
  final ImageProcessor imageProcessor;
  final OcrService ocrService;

  @override
  State<LibraryScreen> createState() => _LibraryScreenState();
}

class _LibraryScreenState extends State<LibraryScreen> {
  final _search = TextEditingController();
  List<CardRecord> _records = [];
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _load();
    _search.addListener(() => setState(() {}));
  }

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    final records = await widget.repository.all(game: widget.game);
    if (mounted) setState(() { _records = records; _loading = false; });
  }

  List<CardRecord> get _visible {
    final query = _search.text.trim().toLowerCase();
    final filtered = query.isEmpty
        ? _records
        : _records.where((record) {
            return record.name.toLowerCase().contains(query) ||
                record.typeLine.toLowerCase().contains(query) ||
                record.rulesText.toLowerCase().contains(query);
          }).toList();
    return query.isEmpty ? filtered.take(10).toList() : filtered;
  }

  Future<void> _addCard() async {
    final path = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const CaptureScreen(title: 'Photograph card')),
    );
    if (path == null || !mounted) return;
    final draft = await Navigator.of(context).push<CaptureDraft>(
      MaterialPageRoute(
        builder: (_) => DraftReviewScreen(
          game: widget.game,
          photoPath: path,
          repository: widget.repository,
          imageProcessor: widget.imageProcessor,
          ocrService: widget.ocrService,
          title: 'Check card details',
        ),
      ),
    );
    if (draft == null || !mounted) {
      await _delete(path);
      return;
    }
    final message = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FinalCardScreen(
          draft: draft,
          repository: widget.repository,
          imageProcessor: widget.imageProcessor,
        ),
      ),
    );
    await _delete(path);
    if (message != null) {
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<void> _copyCard() async {
    final message = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => CopyCardScreen(
          game: widget.game,
          repository: widget.repository,
          imageProcessor: widget.imageProcessor,
          ocrService: widget.ocrService,
        ),
      ),
    );
    if (message != null) {
      await _load();
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
    }
  }

  Future<void> _export(CardRecord record) async {
    try {
      await widget.repository.exportToGallery(record);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${record.name} exported to the Card Display album.')),
        );
      }
    } catch (error) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Export failed: $error')),
        );
      }
    }
  }

  Future<void> _showVersions(CardRecord selected) async {
    final versions = _records
        .where((record) => record.name.toLowerCase() == selected.name.toLowerCase())
        .toList();
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 12),
              child: Text('${selected.name} versions', style: Theme.of(context).textTheme.titleLarge),
            ),
            for (final record in versions)
              ListTile(
                leading: SizedBox(
                  width: 42,
                  child: PrivateCardThumbnail(record: record, repository: widget.repository),
                ),
                title: Text(record.isCopy ? 'Text-only copy' : 'Four-color photo'),
                subtitle: Text(record.updatedAt.toLocal().toString().split('.').first),
                trailing: const Icon(Icons.upload_outlined),
                onTap: () {
                  Navigator.pop(context);
                  _export(record);
                },
              ),
          ],
        ),
      ),
    );
  }

  Future<void> _delete(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  @override
  Widget build(BuildContext context) {
    final visible = _visible;
    return Scaffold(
      appBar: AppBar(title: Text(widget.game.shortLabel)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 12),
            child: TextField(
              controller: _search,
              decoration: const InputDecoration(
                hintText: 'Search saved cards',
                prefixIcon: Icon(Icons.search),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _copyCard,
                    icon: const Icon(Icons.copy_all_outlined),
                    label: const Text('Copy card'),
                  ),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: FilledButton.tonalIcon(
                    onPressed: _addCard,
                    icon: const Icon(Icons.add_a_photo_outlined),
                    label: const Text('New card'),
                  ),
                ),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(18, 18, 18, 8),
            child: Align(
              alignment: Alignment.centerLeft,
              child: Text(
                _search.text.isEmpty ? 'Last 10 cards' : '${visible.length} results',
                style: Theme.of(context).textTheme.titleMedium,
              ),
            ),
          ),
          Expanded(
            child: _loading
                ? const Center(child: CircularProgressIndicator())
                : visible.isEmpty
                    ? const Center(
                        child: Padding(
                          padding: EdgeInsets.all(28),
                          child: Text(
                            'No saved cards yet. Photograph a physical card to begin.',
                            textAlign: TextAlign.center,
                          ),
                        ),
                      )
                    : GridView.builder(
                        padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          childAspectRatio: .58,
                          crossAxisSpacing: 12,
                          mainAxisSpacing: 12,
                        ),
                        itemCount: visible.length,
                        itemBuilder: (context, index) {
                          final record = visible[index];
                          return Card(
                            child: InkWell(
                              onTap: () => _export(record),
                              onLongPress: () => _showVersions(record),
                              child: Column(
                                crossAxisAlignment: CrossAxisAlignment.stretch,
                                children: [
                                  Expanded(
                                    child: PrivateCardThumbnail(
                                      record: record,
                                      repository: widget.repository,
                                    ),
                                  ),
                                  Padding(
                                    padding: const EdgeInsets.all(10),
                                    child: Text(
                                      record.name,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: Theme.of(context).textTheme.titleSmall,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
          ),
        ],
      ),
    );
  }
}
