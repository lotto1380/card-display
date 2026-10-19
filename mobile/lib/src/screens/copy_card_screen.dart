import 'dart:io';

import 'package:flutter/material.dart';

import '../models/capture_draft.dart';
import '../models/card_record.dart';
import '../repositories/card_repository.dart';
import '../services/image_processor.dart';
import '../services/ocr_service.dart';
import 'capture_screen.dart';
import 'draft_review_screen.dart';
import 'final_card_screen.dart';

class CopyCardScreen extends StatefulWidget {
  const CopyCardScreen({
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
  State<CopyCardScreen> createState() => _CopyCardScreenState();
}

class _CopyCardScreenState extends State<CopyCardScreen> {
  CaptureDraft? _copyingCard;
  CaptureDraft? _copiedCard;
  bool _busy = false;

  @override
  void dispose() {
    final first = _copyingCard?.photoPath;
    final second = _copiedCard?.photoPath;
    if (first != null && first.isNotEmpty) File(first).delete().ignore();
    if (second != null && second.isNotEmpty) File(second).delete().ignore();
    super.dispose();
  }

  Future<CaptureDraft?> _scan(String cameraTitle, String reviewTitle) async {
    final path = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => CaptureScreen(title: cameraTitle)),
    );
    if (path == null || !mounted) return null;
    final result = await Navigator.of(context).push<CaptureDraft>(
      MaterialPageRoute(
        builder: (_) => DraftReviewScreen(
          game: widget.game,
          photoPath: path,
          repository: widget.repository,
          imageProcessor: widget.imageProcessor,
          ocrService: widget.ocrService,
          title: reviewTitle,
        ),
      ),
    );
    if (result == null) await _delete(path);
    return result;
  }

  Future<void> _scanCopyingCard() async {
    setState(() => _busy = true);
    final result = await _scan('Card causing the copy', 'Confirm copying card');
    if (mounted) setState(() { _copyingCard = result; _busy = false; });
  }

  Future<void> _scanCopiedCard() async {
    setState(() => _busy = true);
    final result = await _scan('Card being copied', 'Confirm copied card');
    if (mounted) setState(() { _copiedCard = result; _busy = false; });
  }

  Future<void> _chooseSavedSource() async {
    final records = await widget.repository.all(game: widget.game);
    if (!mounted) return;
    if (records.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No saved cards are available to search yet.')),
      );
      return;
    }
    final selected = await showSearch<CardRecord?>(
      context: context,
      delegate: _SavedCardSearch(records),
    );
    if (selected == null || !mounted) return;
    setState(() {
      _copyingCard = CaptureDraft(
        game: selected.game,
        photoPath: '',
        name: selected.name,
        typeLine: selected.typeLine,
        rulesText: selected.rulesText,
        rawOcr: selected.name,
      );
    });
  }

  Future<void> _compose() async {
    final source = _copyingCard;
    final copied = _copiedCard;
    if (source == null || copied == null) return;
    final cleanedType = copied.typeLine
        .replaceAll(RegExp(r'\blegendary\s*', caseSensitive: false), '')
        .trim();
    final draft = CaptureDraft(
      game: copied.game,
      photoPath: copied.photoPath,
      name: '${copied.name} Copy',
      typeLine: cleanedType,
      rulesText: copied.rulesText,
      rawOcr: copied.rawOcr,
    );
    final message = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => FinalCardScreen(
          draft: draft,
          repository: widget.repository,
          imageProcessor: widget.imageProcessor,
          textOnly: true,
          sourceCardName: source.name,
        ),
      ),
    );
    if (message != null) {
      if (source.photoPath.isNotEmpty) await _delete(source.photoPath);
      await _delete(copied.photoPath);
      if (mounted) Navigator.pop(context, message);
    }
  }

  Future<void> _delete(String path) async {
    final file = File(path);
    if (await file.exists()) await file.delete();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Copy a card')),
      body: ListView(
        padding: const EdgeInsets.all(18),
        children: [
          Text(
            'Photograph both cards. The final copy has no artwork and uses the full display for editable game text.',
            style: Theme.of(context).textTheme.bodyLarge,
          ),
          const SizedBox(height: 22),
          _CopyStep(
            number: 1,
            title: 'Card causing the copy',
            value: _copyingCard?.name,
            onPressed: _busy ? null : _scanCopyingCard,
          ),
          TextButton.icon(
            onPressed: _busy ? null : _chooseSavedSource,
            icon: const Icon(Icons.search),
            label: const Text('Search saved cards instead'),
          ),
          const SizedBox(height: 14),
          _CopyStep(
            number: 2,
            title: 'Card being copied',
            value: _copiedCard?.name,
            onPressed: _busy ? null : _scanCopiedCard,
          ),
          const SizedBox(height: 24),
          Card(
            color: Theme.of(context).colorScheme.secondaryContainer,
            child: const Padding(
              padding: EdgeInsets.all(14),
              child: Text(
                'Card-specific copy effects cannot always be inferred reliably. '
                'Review and edit the final game text before saving.',
              ),
            ),
          ),
          const SizedBox(height: 20),
          FilledButton.icon(
            onPressed: _copyingCard != null && _copiedCard != null && !_busy ? _compose : null,
            icon: const Icon(Icons.copy_all_outlined),
            label: const Text('Create editable copy'),
          ),
        ],
      ),
    );
  }
}

class _SavedCardSearch extends SearchDelegate<CardRecord?> {
  _SavedCardSearch(this.records);

  final List<CardRecord> records;

  @override
  List<Widget>? buildActions(BuildContext context) => [
        IconButton(
          tooltip: 'Clear',
          onPressed: () => query = '',
          icon: const Icon(Icons.clear),
        ),
      ];

  @override
  Widget? buildLeading(BuildContext context) => IconButton(
        tooltip: 'Back',
        onPressed: () => close(context, null),
        icon: const Icon(Icons.arrow_back),
      );

  @override
  Widget buildResults(BuildContext context) => _results(context);

  @override
  Widget buildSuggestions(BuildContext context) => _results(context);

  Widget _results(BuildContext context) {
    final normalized = query.trim().toLowerCase();
    final matches = records.where((record) {
      return normalized.isEmpty || record.name.toLowerCase().contains(normalized);
    }).take(30);
    return ListView(
      children: [
        for (final record in matches)
          ListTile(
            leading: const Icon(Icons.style_outlined),
            title: Text(record.name),
            subtitle: Text(record.typeLine, maxLines: 1, overflow: TextOverflow.ellipsis),
            onTap: () => close(context, record),
          ),
      ],
    );
  }
}

class _CopyStep extends StatelessWidget {
  const _CopyStep({
    required this.number,
    required this.title,
    required this.value,
    required this.onPressed,
  });

  final int number;
  final String title;
  final String? value;
  final VoidCallback? onPressed;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: CircleAvatar(child: Text('$number')),
        title: Text(title),
        subtitle: Text(value ?? 'Not scanned'),
        trailing: Icon(value == null ? Icons.camera_alt_outlined : Icons.check_circle),
        onTap: onPressed,
      ),
    );
  }
}
