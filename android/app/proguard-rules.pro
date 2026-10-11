# Add project specific ProGuard rules here.
-keep class com.waymark.app.** { *; }

# OkHttp — suppress missing class warnings
-dontwarn okhttp3.internal.platform.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# WebRTC
-keep class org.webrtc.** { *; }
-dontwarn org.webrtc.**

# AutoValue / JavaPoet — annotation processing classes not needed at runtime
-dontwarn javax.lang.model.**
-dontwarn com.squareup.javapoet.**
-dontwarn autovalue.shaded.**
-dontwarn com.google.auto.value.processor.**
