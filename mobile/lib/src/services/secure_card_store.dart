import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:path_provider/path_provider.dart';

/// Encrypts processed images before they are written to app-private storage.
/// The key is held by Android's secure storage and is never placed in metadata.
class SecureCardStore {
  static const _keyName = 'card_display_image_key_v1';
  static const _formatVersion = 1;
  static const _nonceLength = 12;
  static const _macLength = 16;

  /// The key never leaves this device: a backup that includes the encrypted
  /// images cannot be read anywhere else.
  final FlutterSecureStorage _secureStorage = const FlutterSecureStorage(
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );
  final AesGcm _cipher = AesGcm.with256bits();

  Future<Directory> _imageDirectory() async {
    final root = await getApplicationSupportDirectory();
    final directory = Directory('${root.path}/private_cards');
    if (!await directory.exists()) {
      await directory.create(recursive: true);
    }
    return directory;
  }

  Future<SecretKey> _key() async {
    var encoded = await _secureStorage.read(key: _keyName);
    if (encoded == null) {
      final random = Random.secure();
      final bytes = List<int>.generate(32, (_) => random.nextInt(256));
      encoded = base64Encode(bytes);
      await _secureStorage.write(key: _keyName, value: encoded);
    }
    return SecretKey(base64Decode(encoded));
  }

  Future<void> write(String imageId, Uint8List clearBytes) async {
    final random = Random.secure();
    final nonce = List<int>.generate(_nonceLength, (_) => random.nextInt(256));
    final box = await _cipher.encrypt(
      clearBytes,
      secretKey: await _key(),
      nonce: nonce,
    );
    final payload = BytesBuilder(copy: false)
      ..addByte(_formatVersion)
      ..add(nonce)
      ..add(box.mac.bytes)
      ..add(box.cipherText);
    final directory = await _imageDirectory();
    await File('${directory.path}/$imageId.cdimg')
        .writeAsBytes(payload.takeBytes(), flush: true);
  }

  Future<Uint8List> read(String imageId) async {
    final directory = await _imageDirectory();
    final payload = await File('${directory.path}/$imageId.cdimg').readAsBytes();
    if (payload.length < 1 + _nonceLength + _macLength ||
        payload.first != _formatVersion) {
      throw const FormatException('Unsupported encrypted image format.');
    }
    final nonceStart = 1;
    final macStart = nonceStart + _nonceLength;
    final cipherStart = macStart + _macLength;
    final box = SecretBox(
      payload.sublist(cipherStart),
      nonce: payload.sublist(nonceStart, macStart),
      mac: Mac(payload.sublist(macStart, cipherStart)),
    );
    final clear = await _cipher.decrypt(box, secretKey: await _key());
    return Uint8List.fromList(clear);
  }

  Future<void> delete(String imageId) async {
    final directory = await _imageDirectory();
    final file = File('${directory.path}/$imageId.cdimg');
    if (await file.exists()) {
      await file.delete();
    }
  }
}
