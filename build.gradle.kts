plugins { java }

sourceSets { test { java { setSrcDirs(listOf("examples")) } } }

repositories {
  maven { url = uri("https://maven.aliyun.com/repository/public/") }
  maven { url = uri("https://maven.aliyun.com/repository/spring/") }
  mavenLocal()
  mavenCentral()
}

dependencies {
  implementation("org.nervos.ckb:ckb:2.1.0")
  testImplementation("io.github.cdimascio:dotenv-java:3.0.0")
  testImplementation("org.junit.jupiter:junit-jupiter:5.7.1")
  testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.named<Test>("test") {
  useJUnitPlatform()

  maxHeapSize = "1G"

  testLogging { events("passed") }
}
