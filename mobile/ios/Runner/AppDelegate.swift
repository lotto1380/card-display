import Flutter
import UIKit

@main
@objc class AppDelegate: FlutterAppDelegate {
  private let privacyTag = 847_221

  override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
  ) -> Bool {
    GeneratedPluginRegistrant.register(with: self)
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(updateCaptureProtection),
      name: UIScreen.capturedDidChangeNotification,
      object: nil
    )
    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  override func applicationWillResignActive(_ application: UIApplication) {
    super.applicationWillResignActive(application)
    showPrivacyCover()
  }

  override func applicationDidBecomeActive(_ application: UIApplication) {
    super.applicationDidBecomeActive(application)
    updateCaptureProtection()
  }

  @objc private func updateCaptureProtection() {
    if UIScreen.main.isCaptured {
      showPrivacyCover()
    } else {
      hidePrivacyCover()
    }
  }

  private func showPrivacyCover() {
    guard let window = window, window.viewWithTag(privacyTag) == nil else { return }
    let cover = UIView(frame: window.bounds)
    cover.tag = privacyTag
    cover.backgroundColor = .black
    cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]

    let label = UILabel(frame: cover.bounds.insetBy(dx: 24, dy: 24))
    label.text = "Card Display\nPrivate screen hidden"
    label.textColor = .white
    label.textAlignment = .center
    label.numberOfLines = 0
    label.font = .systemFont(ofSize: 22, weight: .semibold)
    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    cover.addSubview(label)
    window.addSubview(cover)
  }

  private func hidePrivacyCover() {
    window?.viewWithTag(privacyTag)?.removeFromSuperview()
  }
}
