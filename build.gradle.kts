plugins {
    java
}

sourceSets {
    main {
        java {
            setSrcDirs(listOf("env"))
        }
    }

    test {
        java {
            setSrcDirs(listOf("examples"))
        }
    }
}

repositories {
    mavenCentral()
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:5.7.1")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.named<Test>("test") {
    useJUnitPlatform()

    maxHeapSize = "1G"

    testLogging {
        events("passed")
    }
}
