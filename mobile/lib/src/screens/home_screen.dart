import 'package:flutter/material.dart';

import '../models/card_record.dart';
import '../repositories/card_repository.dart';
import '../services/image_processor.dart';
import '../services/ocr_service.dart';
import 'library_screen.dart';
import 'settings_screen.dart';

class HomeScreen extends StatelessWidget {
  const HomeScreen({
    required this.repository,
    required this.imageProcessor,
    required this.ocrService,
    super.key,
  });

  final CardRepository repository;
  final ImageProcessor imageProcessor;
  final OcrService ocrService;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Card Display'),
        actions: [
          IconButton(
            tooltip: 'Settings',
            icon: const Icon(Icons.settings_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const SettingsScreen()),
            ),
          ),
        ],
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Choose a game',
                style: Theme.of(context).textTheme.headlineMedium,
              ),
              const SizedBox(height: 6),
              Text(
                'Your cards stay on this device unless you export one.',
                style: Theme.of(context).textTheme.bodyLarge,
              ),
              const SizedBox(height: 24),
              Expanded(
                child: GridView.count(
                  crossAxisCount: 2,
                  crossAxisSpacing: 16,
                  mainAxisSpacing: 16,
                  childAspectRatio: .78,
                  children: [
                    _GameButton(
                      game: GameKind.mtg,
                      icon: Icons.auto_awesome,
                      color: const Color(0xFF8A3A24),
                      onTap: () => _open(context, GameKind.mtg),
                    ),
                    _GameButton(
                      game: GameKind.swu,
                      icon: Icons.rocket_launch_outlined,
                      color: const Color(0xFF28537A),
                      onTap: () => _open(context, GameKind.swu),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  void _open(BuildContext context, GameKind game) {
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => LibraryScreen(
          game: game,
          repository: repository,
          imageProcessor: imageProcessor,
          ocrService: ocrService,
        ),
      ),
    );
  }
}

class _GameButton extends StatelessWidget {
  const _GameButton({
    required this.game,
    required this.icon,
    required this.color,
    required this.onTap,
  });

  final GameKind game;
  final IconData icon;
  final Color color;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: color, size: 58),
              const SizedBox(height: 18),
              Text(
                game.shortLabel,
                style: Theme.of(context).textTheme.headlineSmall,
              ),
              const SizedBox(height: 6),
              Text(
                game.label,
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyMedium,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
