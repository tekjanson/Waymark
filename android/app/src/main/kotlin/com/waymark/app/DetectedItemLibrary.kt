/* ============================================================
   DetectedItemLibrary.kt — Large label normalization + scoring
   ============================================================ */

package com.waymark.app

import java.util.Locale

object DetectedItemLibrary {

    private data class ItemProfile(
        val canonical: String,
        val aliases: Set<String>,
        val minScore: Float,
    )

    private val profiles = listOf(
        ItemProfile("person", setOf("person", "people", "human", "man", "woman", "adult", "child"), 0.50f),
        ItemProfile("bicycle", setOf("bicycle", "bike", "cycle"), 0.32f),
        ItemProfile("car", setOf("car", "sedan", "vehicle", "automobile"), 0.30f),
        ItemProfile("motorcycle", setOf("motorcycle", "motorbike", "bike-motor"), 0.34f),
        ItemProfile("bus", setOf("bus", "coach", "shuttle"), 0.34f),
        ItemProfile("truck", setOf("truck", "lorry", "pickup", "van"), 0.34f),
        ItemProfile("traffic light", setOf("traffic light", "signal light"), 0.32f),
        ItemProfile("stop sign", setOf("stop sign", "road sign"), 0.32f),
        ItemProfile("bench", setOf("bench", "seat bench"), 0.30f),
        ItemProfile("bird", setOf("bird", "parrot", "crow", "pigeon"), 0.50f),
        ItemProfile("cat", setOf("cat", "kitten"), 0.55f),
        ItemProfile("dog", setOf("dog", "puppy", "canine"), 0.55f),
        ItemProfile("horse", setOf("horse", "pony"), 0.55f),
        ItemProfile("sheep", setOf("sheep", "lamb"), 0.55f),
        ItemProfile("cow", setOf("cow", "cattle"), 0.55f),
        ItemProfile("elephant", setOf("elephant"), 0.60f),
        ItemProfile("bear", setOf("bear"), 0.60f),
        ItemProfile("zebra", setOf("zebra"), 0.60f),
        ItemProfile("giraffe", setOf("giraffe"), 0.60f),
        ItemProfile("backpack", setOf("backpack", "bagpack", "rucksack"), 0.30f),
        ItemProfile("umbrella", setOf("umbrella"), 0.30f),
        ItemProfile("handbag", setOf("handbag", "purse", "bag"), 0.30f),
        ItemProfile("tie", setOf("tie", "necktie"), 0.30f),
        ItemProfile("suitcase", setOf("suitcase", "luggage"), 0.30f),
        ItemProfile("frisbee", setOf("frisbee"), 0.28f),
        ItemProfile("skis", setOf("skis", "ski"), 0.35f),
        ItemProfile("snowboard", setOf("snowboard"), 0.35f),
        ItemProfile("sports ball", setOf("sports ball", "ball", "soccer ball", "basketball", "tennis ball"), 0.32f),
        ItemProfile("kite", setOf("kite"), 0.32f),
        ItemProfile("baseball bat", setOf("baseball bat", "bat"), 0.32f),
        ItemProfile("baseball glove", setOf("baseball glove", "glove"), 0.32f),
        ItemProfile("skateboard", setOf("skateboard"), 0.32f),
        ItemProfile("surfboard", setOf("surfboard"), 0.34f),
        ItemProfile("tennis racket", setOf("tennis racket", "racket"), 0.34f),
        ItemProfile("bottle", setOf("bottle", "water bottle", "drink bottle"), 0.22f),
        ItemProfile("wine glass", setOf("wine glass", "glass"), 0.24f),
        ItemProfile("cup", setOf("cup", "mug", "tumbler", "coffee cup"), 0.22f),
        ItemProfile("fork", setOf("fork"), 0.26f),
        ItemProfile("knife", setOf("knife"), 0.26f),
        ItemProfile("spoon", setOf("spoon"), 0.26f),
        ItemProfile("bowl", setOf("bowl"), 0.24f),
        ItemProfile("banana", setOf("banana"), 0.28f),
        ItemProfile("apple", setOf("apple"), 0.28f),
        ItemProfile("sandwich", setOf("sandwich"), 0.28f),
        ItemProfile("orange", setOf("orange"), 0.28f),
        ItemProfile("broccoli", setOf("broccoli"), 0.28f),
        ItemProfile("carrot", setOf("carrot"), 0.28f),
        ItemProfile("hot dog", setOf("hot dog", "hotdog"), 0.28f),
        ItemProfile("pizza", setOf("pizza"), 0.28f),
        ItemProfile("donut", setOf("donut", "doughnut"), 0.28f),
        ItemProfile("cake", setOf("cake"), 0.28f),
        ItemProfile("chair", setOf("chair", "seat", "stool"), 0.18f),
        ItemProfile("couch", setOf("couch", "sofa", "loveseat"), 0.20f),
        ItemProfile("potted plant", setOf("potted plant", "plant", "flower pot"), 0.20f),
        ItemProfile("bed", setOf("bed", "mattress"), 0.22f),
        ItemProfile("dining table", setOf("dining table", "table", "desk table"), 0.20f),
        ItemProfile("toilet", setOf("toilet"), 0.24f),
        ItemProfile("tv", setOf("tv", "television", "monitor", "screen", "display"), 0.20f),
        ItemProfile("laptop", setOf("laptop", "notebook", "computer"), 0.18f),
        ItemProfile("mouse", setOf("mouse", "computer mouse"), 0.20f),
        ItemProfile("remote", setOf("remote", "remote control"), 0.22f),
        ItemProfile("keyboard", setOf("keyboard"), 0.20f),
        ItemProfile("cell phone", setOf("cell phone", "phone", "mobile", "smartphone"), 0.20f),
        ItemProfile("microwave", setOf("microwave"), 0.24f),
        ItemProfile("oven", setOf("oven"), 0.24f),
        ItemProfile("toaster", setOf("toaster"), 0.24f),
        ItemProfile("sink", setOf("sink"), 0.24f),
        ItemProfile("refrigerator", setOf("refrigerator", "fridge"), 0.24f),
        ItemProfile("book", setOf("book", "notebook paper"), 0.22f),
        ItemProfile("clock", setOf("clock", "wall clock"), 0.24f),
        ItemProfile("vase", setOf("vase"), 0.24f),
        ItemProfile("scissors", setOf("scissors"), 0.26f),
        ItemProfile("teddy bear", setOf("teddy bear", "stuffed toy", "plush"), 0.30f),
        ItemProfile("hair drier", setOf("hair drier", "hair dryer"), 0.30f),
        ItemProfile("toothbrush", setOf("toothbrush"), 0.30f),
        ItemProfile("fan", setOf("fan", "ceiling fan", "desk fan"), 0.22f),
        ItemProfile("light", setOf("light", "lamp", "bulb", "ceiling light", "fixture"), 0.20f),
        ItemProfile("door", setOf("door", "doorway"), 0.20f),
        ItemProfile("window", setOf("window"), 0.20f),
        ItemProfile("cabinet", setOf("cabinet", "cupboard", "drawer"), 0.22f),
        ItemProfile("shelf", setOf("shelf", "bookcase"), 0.22f),
        ItemProfile("wall", setOf("wall"), 0.20f),
        ItemProfile("floor", setOf("floor"), 0.20f),
    )

    private val aliasToProfile: Map<String, ItemProfile> = buildMap {
        profiles.forEach { profile ->
            put(profile.canonical, profile)
            profile.aliases.forEach { alias -> put(alias, profile) }
        }
    }

    fun normalizeLabel(rawLabel: String): String {
        val key = normalizeKey(rawLabel)
        val profile = aliasToProfile[key]
        return profile?.canonical ?: key
    }

    fun minScoreFor(label: String): Float {
        val key = normalizeKey(label)
        val profile = aliasToProfile[key] ?: aliasToProfile[normalizeLabel(label)]
        return profile?.minScore ?: 0.28f
    }

    fun shouldKeep(label: String, score: Float): Boolean {
        val minScore = minScoreFor(label)
        return score >= minScore
    }

    private fun normalizeKey(value: String): String {
        return value
            .trim()
            .lowercase(Locale.US)
            .replace('_', ' ')
            .replace('-', ' ')
            .replace(Regex("\\s+"), " ")
    }
}
