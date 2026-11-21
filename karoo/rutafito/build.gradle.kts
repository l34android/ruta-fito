// Ruta Fito Karoo extension. Built inside a checkout of hammerheadnav/karoo-ext (see .github/workflows/preview.yml),
// so it uses that repo's version catalog and its `:lib` module as source.
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.jetbrains.kotlin.android)
    alias(libs.plugins.jetbrains.kotlin.serialization)
}

android {
    namespace = "ar.rutafito.karoo"
    compileSdk = 35

    defaultConfig {
        applicationId = "ar.rutafito.karoo"
        minSdk = 23
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0.${System.getenv("GITHUB_RUN_NUMBER") ?: "0"}"
        // Injected by CI; never committed.
        buildConfigField("String", "INGEST_URL", "\"${System.getenv("INGEST_URL") ?: ""}\"")
        buildConfigField("String", "INGEST_KEY", "\"${System.getenv("KAROO_KEY") ?: ""}\"")
    }
    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    kotlinOptions { jvmTarget = "1.8" }
    buildFeatures { buildConfig = true }
}

dependencies {
    implementation(project(":lib"))
    implementation(libs.timber)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.androidx.core.ktx)
}
