import 'package:flutter/material.dart';

class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Settings')),
      body: ListView(
        children: const [
          ListTile(
            leading: Icon(Icons.phone_android),
            title: Text('Device transfer'),
            subtitle: Text('Test mode: export PNG to the Card Display photo album'),
          ),
          Divider(),
          ListTile(
            leading: Icon(Icons.lock_outline),
            title: Text('Private card storage'),
            subtitle: Text('Enabled — processed images are encrypted inside the app'),
          ),
          ListTile(
            leading: Icon(Icons.screenshot_monitor_outlined),
            title: Text('Screen capture protection'),
            subtitle: Text(
              'Android: FLAG_SECURE. iPhone: privacy cover for backgrounding and detected recording.',
            ),
          ),
          Divider(),
          ListTile(
            enabled: false,
            leading: Icon(Icons.nfc),
            title: Text('Santek NFC transfer'),
            subtitle: Text('Waiting for the EZ Sign SDK'),
          ),
          ListTile(
            enabled: false,
            leading: Icon(Icons.verified_user_outlined),
            title: Text('Sold-device registration'),
            subtitle: Text('Waiting for hardware-ID access in the SDK'),
          ),
          Divider(),
          AboutListTile(
            applicationName: 'Card Display',
            applicationVersion: '0.2.0 mobile MVP',
            applicationLegalese: 'User-captured physical cards only. No preloaded card database.',
          ),
        ],
      ),
    );
  }
}
