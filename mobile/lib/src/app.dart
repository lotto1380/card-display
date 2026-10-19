import 'package:flutter/material.dart';

import 'repositories/card_repository.dart';
import 'screens/home_screen.dart';
import 'services/image_processor.dart';
import 'services/ocr_service.dart';
import 'services/secure_card_store.dart';

class CardDisplayApp extends StatefulWidget {
  const CardDisplayApp({super.key});

  @override
  State<CardDisplayApp> createState() => _CardDisplayAppState();
}

class _CardDisplayAppState extends State<CardDisplayApp> {
  late final CardRepository repository;
  late final ImageProcessor imageProcessor;
  late final OcrService ocrService;

  @override
  void initState() {
    super.initState();
    repository = CardRepository(SecureCardStore());
    imageProcessor = ImageProcessor();
    ocrService = OcrService();
  }

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF314D64);
    return MaterialApp(
      debugShowCheckedModeBanner: false,
      title: 'Card Display',
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(
          seedColor: seed,
          brightness: Brightness.light,
        ),
        useMaterial3: true,
        inputDecorationTheme: const InputDecorationTheme(
          border: OutlineInputBorder(),
        ),
        cardTheme: const CardThemeData(
          clipBehavior: Clip.antiAlias,
          margin: EdgeInsets.zero,
        ),
      ),
      home: HomeScreen(
        repository: repository,
        imageProcessor: imageProcessor,
        ocrService: ocrService,
      ),
    );
  }
}
