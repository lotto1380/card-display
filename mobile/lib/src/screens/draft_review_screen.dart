import 'dart:io';

import 'package:flutter/material.dart';

import '../models/capture_draft.dart';
import '../models/card_record.dart';
import '../repositories/card_repository.dart';
import '../services/image_processor.dart';
import '../services/ocr_service.dart';

class DraftReviewScreen extends StatefulWidget {
  const DraftReviewScreen({
    required this.game,
    required this.photoPath,
    required this.repository,
    required this.imageProcessor,
    required this.ocrService,
    required this.title,
    super.key,
  });

  final GameKind game;
  final String photoPath;
  final CardRepository repository;
  final ImageProcessor imageProcessor;
  final OcrService ocrService;
  final String title;

  @override
  State<DraftReviewScreen> createState() => _DraftReviewScreenState();
}

class _DraftReviewScreenState extends State<DraftReviewScreen> {
  final _name = TextEditingController();
  final _type = TextEditingController();
  final _rules = TextEditingController();
  bool _loading = true;
  String? _error;
  String _rawOcr = '';
  ImageQualityReport? _quality;

  @override
  void initState() {
    super.initState();
    _analyze();
  }

  Future<void> _analyze() async {
    try {
      final results = await Future.wait<Object>([
        widget.ocrService.read(widget.photoPath),
        widget.imageProcessor.inspectFile(widget.photoPath),
      ]);
      final ocr = results[0] as OcrResult;
      final quality = results[1] as ImageQualityReport;
      final correction = await widget.repository.correctionFor(widget.game, ocr.name);
      if (!mounted) return;
      setState(() {
        _name.text = correction?.name ?? ocr.name;
        _type.text = correction?.typeLine ?? ocr.typeLine;
        _rules.text = correction?.rulesText ?? ocr.rulesText;
        _rawOcr = ocr.rawText;
        _quality = quality;
        _loading = false;
      });
    } catch (error) {
      if (mounted) setState(() { _error = '$error'; _loading = false; });
    }
  }

  @override
  void dispose() {
    _name.dispose();
    _type.dispose();
    _rules.dispose();
    super.dispose();
  }

  void _confirm() {
    Navigator.pop(
      context,
      CaptureDraft(
        game: widget.game,
        photoPath: widget.photoPath,
        name: _name.text,
        typeLine: _type.text,
        rulesText: _rules.text,
        rawOcr: _rawOcr,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : ListView(
              padding: const EdgeInsets.all(16),
              children: [
                AspectRatio(
                  aspectRatio: 3 / 4,
                  child: ClipRRect(
                    borderRadius: BorderRadius.circular(14),
                    child: Image.file(File(widget.photoPath), fit: BoxFit.cover),
                  ),
                ),
                const SizedBox(height: 16),
                if (_quality != null && _quality!.warnings.isNotEmpty)
                  Card(
                    color: Theme.of(context).colorScheme.errorContainer,
                    child: Padding(
                      padding: const EdgeInsets.all(14),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Photo quality warning'),
                          for (final warning in _quality!.warnings)
                            Padding(
                              padding: const EdgeInsets.only(top: 5),
                              child: Text('• $warning'),
                            ),
                        ],
                      ),
                    ),
                  ),
                if (_error != null)
                  Text('Automatic reading failed. Enter the details manually.\n$_error'),
                const SizedBox(height: 12),
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
                  decoration: const InputDecoration(
                    labelText: 'Game text',
                    alignLabelWithHint: true,
                  ),
                ),
                const SizedBox(height: 20),
                FilledButton.icon(
                  onPressed: _confirm,
                  icon: const Icon(Icons.check),
                  label: const Text('Use this scan'),
                ),
              ],
            ),
    );
  }
}
