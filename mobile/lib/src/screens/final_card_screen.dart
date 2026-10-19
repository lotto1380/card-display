import 'dart:io';
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../models/capture_draft.dart';
import '../models/card_record.dart';
import '../repositories/card_repository.dart';
import '../services/image_processor.dart';

class FinalCardScreen extends StatefulWidget {
  const FinalCardScreen({
    required this.draft,
    required this.repository,
    required this.imageProcessor,
    this.textOnly = false,
    this.sourceCardName,
    super.key,
  });

  final CaptureDraft draft;
  final CardRepository repository;
  final ImageProcessor imageProcessor;
  final bool textOnly;
  final String? sourceCardName;

  @override
  State<FinalCardScreen> createState() => _FinalCardScreenState();
}

class _FinalCardScreenState extends State<FinalCardScreen> {
  late final TextEditingController _name;
  late final TextEditingController _type;
  late final TextEditingController _rules;
  Uint8List? _preview;
  Object? _error;
  bool _working = true;

  @override
  void initState() {
    super.initState();
    _name = TextEditingController(text: widget.draft.name);
    _type = TextEditingController(text: widget.draft.typeLine);
    _rules = TextEditingController(text: widget.draft.rulesText);
    _buildPreview();
  }

  @override
  void dispose() {
    _name.dispose();
    _type.dispose();
    _rules.dispose();
    super.dispose();
  }

  Future<void> _buildPreview() async {
    setState(() { _working = true; _error = null; });
    try {
      final bytes = widget.textOnly
          ? widget.imageProcessor.buildTextOnlyCard(
              title: _name.text,
              typeLine: _type.text,
              rulesText: _rules.text,
              sourceCardName: widget.sourceCardName,
            )
          : await widget.imageProcessor.preparePhoto(widget.draft.photoPath);
      if (mounted) setState(() { _preview = bytes; _working = false; });
    } catch (error) {
      if (mounted) setState(() { _error = error; _working = false; });
    }
  }

  Future<void> _save() async {
    final bytes = _preview;
    if (bytes == null || _working) return;
    setState(() => _working = true);
    try {
      final record = await widget.repository.save(
        game: widget.draft.game,
        name: _name.text,
        typeLine: _type.text,
        rulesText: _rules.text,
        processedPng: bytes,
        isCopy: widget.textOnly,
        sourceCardName: widget.sourceCardName,
      );
      final originalOcrName = widget.draft.rawOcr
          .split(RegExp(r'[\r\n]+'))
          .map((line) => line.trim())
          .firstWhere((line) => line.isNotEmpty, orElse: () => _name.text);
      await widget.repository.saveCorrection(
        widget.draft.game,
        originalOcrName,
        CardCorrection(
          name: _name.text.trim(),
          typeLine: _type.text.trim(),
          rulesText: _rules.text.trim(),
        ),
      );

      String message;
      try {
        await widget.repository.exportToGallery(record);
        message = 'Saved privately and exported to the Card Display photo album.';
      } catch (_) {
        message = 'Saved privately. Photo-library export failed; you can retry from the card list.';
      }
      if (!mounted) return;
      Navigator.pop(context, message);
    } catch (error) {
      if (mounted) {
        setState(() => _working = false);
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('The card could not be saved: $error')),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.textOnly ? 'Review copy' : 'Four-color preview')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Center(
            child: SizedBox(
              width: 300,
              height: 400,
              child: Card(
                child: _working && _preview == null
                    ? const Center(child: CircularProgressIndicator())
                    : _preview == null
                        ? const Center(child: Icon(Icons.broken_image_outlined, size: 52))
                        : Image.memory(_preview!, fit: BoxFit.contain, gaplessPlayback: true),
              ),
            ),
          ),
          const SizedBox(height: 8),
          const Text(
            'Portrait preview: 300 × 400. Device transfer will rotate it to the required 400 × 300 raster later.',
            textAlign: TextAlign.center,
          ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text('Preview error: $_error', style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 18),
          TextField(
            controller: _name,
            decoration: const InputDecoration(labelText: 'Card name'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _type,
            decoration: const InputDecoration(labelText: 'Type line'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _rules,
            minLines: 6,
            maxLines: 14,
            decoration: const InputDecoration(labelText: 'Game text', alignLabelWithHint: true),
          ),
          if (widget.textOnly) ...[
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _working ? null : _buildPreview,
              icon: const Icon(Icons.refresh),
              label: const Text('Update preview after edits'),
            ),
          ],
          const SizedBox(height: 18),
          FilledButton.icon(
            onPressed: _working ? null : _save,
            icon: _working
                ? const SizedBox.square(dimension: 18, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.save_outlined),
            label: const Text('Confirm, save, and export'),
          ),
        ],
      ),
    );
  }
}
