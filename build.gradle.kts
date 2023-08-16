plugins { java }

sourceSets { test { java { setSrcDirs(listOf("env", "examples")) } } }

repositories {
  mavenLocal()
  mavenCentral()
}

dependencies {
  implementation("org.nervos.ckb:ckb:2.1.1")
  implementation("com.alibaba:fastjson:2.0.28")
  testImplementation("io.github.cdimascio:dotenv-java:3.0.0")
  testImplementation("org.junit.jupiter:junit-jupiter:5.7.1")
  testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.named<Test>("test") {
  useJUnitPlatform()

  maxHeapSize = "1G"

  testLogging { events("passed") }
}
