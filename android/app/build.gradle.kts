import java.util.Properties
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

/* Firebase (push) : le plugin ne s'applique que si les fichiers
   google-services.json sont presents — un par app dans src/gestion et
   src/locataire, ou un seul dans app/ qui couvre les deux identifiants.
   Sans eux, l'app se construit et fonctionne, sans notifications push. */
val firebase = file("google-services.json").exists() ||
    (file("src/gestion/google-services.json").exists() && file("src/locataire/google-services.json").exists())
if (firebase) apply(plugin = "com.google.gms.google-services")

/* Signature de publication : android/keystore.properties (hors depot)
     storeFile=/chemin/vers/locamp.jks
     storePassword=…
     keyAlias=…
     keyPassword=…
   Sans ce fichier, seules les versions de debug se signent. */
val signature = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "fr.locamp.app"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        if (signature.isNotEmpty()) {
            create("publication") {
                storeFile = file(signature.getProperty("storeFile"))
                storePassword = signature.getProperty("storePassword")
                keyAlias = signature.getProperty("keyAlias")
                keyPassword = signature.getProperty("keyPassword")
            }
        }
    }

    /* Deux apps, un seul code : ce qui les distingue vit dans
       src/<variante>/java/.../Configuration.kt et src/<variante>/res. */
    flavorDimensions += "app"
    productFlavors {
        create("gestion") {
            dimension = "app"
            // Meme identifiant que l'app actuelle du Play Store (TWA) :
            // la nouvelle app la remplace par une simple mise a jour.
            applicationId = "locamp.onrender.com"
            versionCode = 100
            buildConfigField("String", "LOCAMP_URL", "\"https://locamp.onrender.com/\"")
        }
        create("locataire") {
            dimension = "app"
            applicationId = "fr.locamp.portail"
            buildConfigField("String", "LOCAMP_URL", "\"https://locamp.onrender.com/portail/\"")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (signature.isNotEmpty()) signingConfig = signingConfigs.getByName("publication")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }

    // Le pont avec le site (natif.js, natif-portail.js et leurs CSS) est
    // copie depuis backend/public : une seule source pour iOS, Android et web.
    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("pont").get().asFile)
}

kotlin {
    compilerOptions { jvmTarget.set(JvmTarget.JVM_17) }
}

val copierPont by tasks.registering(Copy::class) {
    from(rootProject.file("../backend/public")) { include("natif.js", "natif.css") }
    from(rootProject.file("../backend/public/portail")) { include("natif-portail.js", "natif-portail.css") }
    into(layout.buildDirectory.dir("pont"))
}
tasks.named("preBuild") { dependsOn(copierPont) }

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.webkit)
    implementation(libs.androidx.splashscreen)
    implementation(libs.androidx.swiperefreshlayout)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.foundation)
    implementation(libs.compose.material3)
    implementation(libs.compose.icons.extended)
    implementation(libs.compose.ui.tooling.preview)
    debugImplementation(libs.compose.ui.tooling)

    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
}
