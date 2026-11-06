/**
 * Template previews for the public landing page: the same Pexels photo picks
 * the gallery shows (apps/studio/library/templates/stock-picks.json), frozen
 * here so signed-out visitors need no API calls. Regenerate from the
 * list-templates action when a template or its picks change.
 */
import type { AspectRatio } from "@crewcut/composition";

export interface LandingTemplate {
  id: string;
  name: string;
  category: string;
  description: string;
  ratios: AspectRatio[];
  previews: Partial<Record<AspectRatio, { values: Record<string, string>; credits: Array<{ text: string; url: string }> }>>;
}

export const LANDING_TEMPLATES: LandingTemplate[] = [
  {
    "id": "golden-hour",
    "name": "Golden Hour",
    "category": "Travel & lifestyle",
    "description": "A warm travel story: five photos drift in soft light, an editorial title, a handwritten note and a slow fade out.",
    "ratios": [
      "9:16",
      "4:5",
      "1:1",
      "16:9"
    ],
    "previews": {
      "9:16": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/27239452/pexels-photo-27239452.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/6737681/pexels-photo-6737681.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-3": "https://images.pexels.com/photos/18792766/pexels-photo-18792766.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-4": "https://images.pexels.com/photos/18194417/pexels-photo-18194417.png?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-5": "https://images.pexels.com/photos/27407808/pexels-photo-27407808.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Yunus Tuğ on Pexels",
            "url": "https://www.pexels.com/photo/a-sunset-over-rooftops-and-the-ocean-27239452/"
          },
          {
            "text": "Photo by Gaspar Zaldo on Pexels",
            "url": "https://www.pexels.com/photo/happy-girls-standing-on-brown-grass-field-6737681/"
          },
          {
            "text": "Photo by Giona Mason on Pexels",
            "url": "https://www.pexels.com/photo/red-tram-on-a-street-in-lisbon-18792766/"
          },
          {
            "text": "Photo by Mine Canan Göldaf on Pexels",
            "url": "https://www.pexels.com/photo/glasses-and-grapes-on-picnic-18194417/"
          },
          {
            "text": "Photo by Yunus  Kılıç on Pexels",
            "url": "https://www.pexels.com/photo/a-silhouette-of-a-woman-holding-a-ball-at-sunset-27407808/"
          }
        ]
      },
      "4:5": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/27239452/pexels-photo-27239452.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/6737681/pexels-photo-6737681.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-3": "https://images.pexels.com/photos/18792766/pexels-photo-18792766.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-4": "https://images.pexels.com/photos/18194417/pexels-photo-18194417.png?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-5": "https://images.pexels.com/photos/27407808/pexels-photo-27407808.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Yunus Tuğ on Pexels",
            "url": "https://www.pexels.com/photo/a-sunset-over-rooftops-and-the-ocean-27239452/"
          },
          {
            "text": "Photo by Gaspar Zaldo on Pexels",
            "url": "https://www.pexels.com/photo/happy-girls-standing-on-brown-grass-field-6737681/"
          },
          {
            "text": "Photo by Giona Mason on Pexels",
            "url": "https://www.pexels.com/photo/red-tram-on-a-street-in-lisbon-18792766/"
          },
          {
            "text": "Photo by Mine Canan Göldaf on Pexels",
            "url": "https://www.pexels.com/photo/glasses-and-grapes-on-picnic-18194417/"
          },
          {
            "text": "Photo by Yunus  Kılıç on Pexels",
            "url": "https://www.pexels.com/photo/a-silhouette-of-a-woman-holding-a-ball-at-sunset-27407808/"
          }
        ]
      },
      "1:1": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/12950778/pexels-photo-12950778.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/6152103/pexels-photo-6152103.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-3": "https://images.pexels.com/photos/38877515/pexels-photo-38877515.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-4": "https://images.pexels.com/photos/38241975/pexels-photo-38241975.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-5": "https://images.pexels.com/photos/1406397/pexels-photo-1406397.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Thomas Dolby on Pexels",
            "url": "https://www.pexels.com/photo/view-of-a-cityscape-12950778/"
          },
          {
            "text": "Photo by Maksim Romashkin on Pexels",
            "url": "https://www.pexels.com/photo/unrecognizable-happy-people-jumping-in-sunset-6152103/"
          },
          {
            "text": "Photo by Mimochodem on Pexels",
            "url": "https://www.pexels.com/photo/red-urban-tramway-in-european-city-street-38877515/"
          },
          {
            "text": "Photo by Bingqian Li on Pexels",
            "url": "https://www.pexels.com/photo/serene-beach-in-hyeres-provence-coastline-38241975/"
          },
          {
            "text": "Photo by Simon Berger on Pexels",
            "url": "https://www.pexels.com/photo/silhouette-of-man-1406397/"
          }
        ]
      },
      "16:9": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/12496267/pexels-photo-12496267.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/1139370/pexels-photo-1139370.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-3": "https://images.pexels.com/photos/8859357/pexels-photo-8859357.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-4": "https://images.pexels.com/photos/5184143/pexels-photo-5184143.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-5": "https://images.pexels.com/photos/30243782/pexels-photo-30243782.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by K on Pexels",
            "url": "https://www.pexels.com/photo/aerial-view-of-city-beside-the-sea-12496267/"
          },
          {
            "text": "Photo by Helena Lopes on Pexels",
            "url": "https://www.pexels.com/photo/man-wearing-black-tank-top-standing-beside-woman-wearing-blue-denim-jacket-1139370/"
          },
          {
            "text": "Photo by Иван Лемехов on Pexels",
            "url": "https://www.pexels.com/photo/tram-and-cars-on-an-illuminated-city-street-8859357/"
          },
          {
            "text": "Photo by Bethany Ferr on Pexels",
            "url": "https://www.pexels.com/photo/woman-in-white-dress-walking-on-white-sand-5184143/"
          },
          {
            "text": "Photo by José Manuel Ramírez Brenis on Pexels",
            "url": "https://www.pexels.com/photo/silhouette-of-pregnant-woman-at-sunset-by-sea-30243782/"
          }
        ]
      }
    }
  },
  {
    "id": "product-drop",
    "name": "Product Drop",
    "category": "Product & promo",
    "description": "A fast launch promo cut to the beat: brand flash, hero shot over giant type, lifestyle shot, price punch and a clear call to action.",
    "ratios": [
      "9:16",
      "4:5",
      "1:1"
    ],
    "previews": {
      "9:16": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/39516826/pexels-photo-39516826.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/40786699/pexels-photo-40786699.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Valentin Ivantsov on Pexels",
            "url": "https://www.pexels.com/photo/colorful-background-featuring-stylish-white-sneakers-39516826/"
          },
          {
            "text": "Photo by Christopher Welsch Leveroni on Pexels",
            "url": "https://www.pexels.com/photo/male-runner-competing-in-outdoor-marathon-40786699/"
          }
        ]
      },
      "4:5": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/39516826/pexels-photo-39516826.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/40786699/pexels-photo-40786699.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Valentin Ivantsov on Pexels",
            "url": "https://www.pexels.com/photo/colorful-background-featuring-stylish-white-sneakers-39516826/"
          },
          {
            "text": "Photo by Christopher Welsch Leveroni on Pexels",
            "url": "https://www.pexels.com/photo/male-runner-competing-in-outdoor-marathon-40786699/"
          }
        ]
      },
      "1:1": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/27204251/pexels-photo-27204251.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/24913608/pexels-photo-24913608.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by José Martin Segura Benites on Pexels",
            "url": "https://www.pexels.com/photo/a-pair-of-white-sneakers-hanging-from-a-rope-27204251/"
          },
          {
            "text": "Photo by Alexis B on Pexels",
            "url": "https://www.pexels.com/photo/a-sidewalk-in-a-city-24913608/"
          }
        ]
      }
    }
  },
  {
    "id": "event-night",
    "name": "Event Night",
    "category": "Events",
    "description": "A neon promo for a party, gig or launch night: the name blurs in letter by letter, a colour-washed crowd shot carries the date, the lineup slides in and the ticket link pulses at the end.",
    "ratios": [
      "9:16",
      "4:5",
      "1:1",
      "16:9"
    ],
    "previews": {
      "9:16": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/39008723/pexels-photo-39008723.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/15696528/pexels-photo-15696528.png?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Caleb Oquendo on Pexels",
            "url": "https://www.pexels.com/photo/person-in-vibrant-concert-lights-with-hands-raised-39008723/"
          },
          {
            "text": "Photo by Madvortex on Pexels",
            "url": "https://www.pexels.com/photo/disc-jockey-mixing-music-in-a-nightclub-15696528/"
          }
        ]
      },
      "4:5": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/39008723/pexels-photo-39008723.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/15696528/pexels-photo-15696528.png?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Caleb Oquendo on Pexels",
            "url": "https://www.pexels.com/photo/person-in-vibrant-concert-lights-with-hands-raised-39008723/"
          },
          {
            "text": "Photo by Madvortex on Pexels",
            "url": "https://www.pexels.com/photo/disc-jockey-mixing-music-in-a-nightclub-15696528/"
          }
        ]
      },
      "1:1": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/426976/pexels-photo-426976.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/2240772/pexels-photo-2240772.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Jacob Morch on Pexels",
            "url": "https://www.pexels.com/photo/people-inside-dark-room-with-spotlights-426976/"
          },
          {
            "text": "Photo by Martin Lopez on Pexels",
            "url": "https://www.pexels.com/photo/man-standing-raising-his-hand-inside-room-2240772/"
          }
        ]
      },
      "16:9": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/32399568/pexels-photo-32399568.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/9005458/pexels-photo-9005458.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Mirian Managadze on Pexels",
            "url": "https://www.pexels.com/photo/energetic-night-concert-with-vibrant-crowd-32399568/"
          },
          {
            "text": "Photo by Yan Krukau on Pexels",
            "url": "https://www.pexels.com/photo/man-using-audio-mixer-9005458/"
          }
        ]
      }
    }
  },
  {
    "id": "top-five",
    "name": "Top Five",
    "category": "Lists & tips",
    "description": "A clean, editorial list on warm paper: a bold title, then five photo cards with big numbers that slide in on the beat, and a save-for-later ending.",
    "ratios": [
      "9:16",
      "4:5",
      "1:1",
      "16:9"
    ],
    "previews": {
      "9:16": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/8534453/pexels-photo-8534453.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/7258034/pexels-photo-7258034.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-3": "https://images.pexels.com/photos/37262440/pexels-photo-37262440.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-4": "https://images.pexels.com/photos/2616164/pexels-photo-2616164.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-5": "https://images.pexels.com/photos/6838576/pexels-photo-6838576.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Hanna Pad on Pexels",
            "url": "https://www.pexels.com/photo/black-pen-over-a-blank-paper-8534453/"
          },
          {
            "text": "Photo by Anna Shvets on Pexels",
            "url": "https://www.pexels.com/photo/an-interior-of-a-bedroom-7258034/"
          },
          {
            "text": "Photo by 🇻🇳🇻🇳Nguyễn Tiến Thịnh 🇻🇳🇻🇳 on Pexels",
            "url": "https://www.pexels.com/photo/joyful-woman-walking-in-sunlit-park-37262440/"
          },
          {
            "text": "Photo by Anna Tukhfatullina Food Photographer/Stylist on Pexels",
            "url": "https://www.pexels.com/photo/pour-over-coffee-brewing-in-bright-kitchen-2616164/"
          },
          {
            "text": "Photo by Kampus Production on Pexels",
            "url": "https://www.pexels.com/photo/elderly-women-playing-a-game-in-the-park-6838576/"
          }
        ]
      },
      "4:5": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/8534453/pexels-photo-8534453.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/7258034/pexels-photo-7258034.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-3": "https://images.pexels.com/photos/37262440/pexels-photo-37262440.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-4": "https://images.pexels.com/photos/2616164/pexels-photo-2616164.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-5": "https://images.pexels.com/photos/6838576/pexels-photo-6838576.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Hanna Pad on Pexels",
            "url": "https://www.pexels.com/photo/black-pen-over-a-blank-paper-8534453/"
          },
          {
            "text": "Photo by Anna Shvets on Pexels",
            "url": "https://www.pexels.com/photo/an-interior-of-a-bedroom-7258034/"
          },
          {
            "text": "Photo by 🇻🇳🇻🇳Nguyễn Tiến Thịnh 🇻🇳🇻🇳 on Pexels",
            "url": "https://www.pexels.com/photo/joyful-woman-walking-in-sunlit-park-37262440/"
          },
          {
            "text": "Photo by Anna Tukhfatullina Food Photographer/Stylist on Pexels",
            "url": "https://www.pexels.com/photo/pour-over-coffee-brewing-in-bright-kitchen-2616164/"
          },
          {
            "text": "Photo by Kampus Production on Pexels",
            "url": "https://www.pexels.com/photo/elderly-women-playing-a-game-in-the-park-6838576/"
          }
        ]
      },
      "1:1": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/37793421/pexels-photo-37793421.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/35229095/pexels-photo-35229095.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-3": "https://images.pexels.com/photos/792770/pexels-photo-792770.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-4": "https://images.pexels.com/photos/16645942/pexels-photo-16645942.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-5": "https://images.pexels.com/photos/16934252/pexels-photo-16934252.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Zeynep  Hız on Pexels",
            "url": "https://www.pexels.com/photo/minimalist-workspace-with-notebook-and-pens-37793421/"
          },
          {
            "text": "Photo by Pușcaș Adryan on Pexels",
            "url": "https://www.pexels.com/photo/modern-minimalist-bedroom-interior-design-35229095/"
          },
          {
            "text": "Photo by Anastasiya Lobanovskaya on Pexels",
            "url": "https://www.pexels.com/photo/photo-of-woman-in-black-tank-top-walking-on-stairs-at-a-park-792770/"
          },
          {
            "text": "Photo by aidin gheshlaghi on Pexels",
            "url": "https://www.pexels.com/photo/woman-pouring-water-from-kettle-to-pitcher-through-sieve-16645942/"
          },
          {
            "text": "Photo by Samuel Peter on Pexels",
            "url": "https://www.pexels.com/photo/portrait-of-two-friends-smiling-16934252/"
          }
        ]
      },
      "16:9": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/8092466/pexels-photo-8092466.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-2": "https://images.pexels.com/photos/4153149/pexels-photo-4153149.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-3": "https://images.pexels.com/photos/36715560/pexels-photo-36715560.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-4": "https://images.pexels.com/photos/27175825/pexels-photo-27175825.jpeg?auto=compress&cs=tinysrgb&h=650&w=940",
          "photo-5": "https://images.pexels.com/photos/5047002/pexels-photo-5047002.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by https://kaboompics.com/ on Pexels",
            "url": "https://www.pexels.com/photo/pen-and-notebook-on-wooden-table-with-glass-vase-8092466/"
          },
          {
            "text": "Photo by cottonbro studio on Pexels",
            "url": "https://www.pexels.com/photo/woman-in-white-long-sleeve-shirt-and-blue-denim-jeans-sitting-on-bed-4153149/"
          },
          {
            "text": "Photo by Vitaly Gariev on Pexels",
            "url": "https://www.pexels.com/photo/young-woman-shopping-outdoors-in-stylish-attire-36715560/"
          },
          {
            "text": "Photo by Helena Lopes on Pexels",
            "url": "https://www.pexels.com/photo/hand-pouring-coffee-grains-into-filter-27175825/"
          },
          {
            "text": "Photo by Ketut Subiyanto on Pexels",
            "url": "https://www.pexels.com/photo/women-holding-disposable-cups-laughing-5047002/"
          }
        ]
      }
    }
  },
  {
    "id": "kinetic-quote",
    "name": "Kinetic Quote",
    "category": "Quotes",
    "description": "A quote revealed word by word in an editorial serif over a slow, darkened photo, with the key words in gold and the author signing off.",
    "ratios": [
      "9:16",
      "4:5",
      "1:1",
      "16:9"
    ],
    "previews": {
      "9:16": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/33277705/pexels-photo-33277705.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Eren Arıcı on Pexels",
            "url": "https://www.pexels.com/photo/serene-misty-mountain-landscape-at-dawn-33277705/"
          }
        ]
      },
      "4:5": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/33277705/pexels-photo-33277705.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Eren Arıcı on Pexels",
            "url": "https://www.pexels.com/photo/serene-misty-mountain-landscape-at-dawn-33277705/"
          }
        ]
      },
      "1:1": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/6103064/pexels-photo-6103064.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Carsten Ruthemann on Pexels",
            "url": "https://www.pexels.com/photo/trees-in-the-forest-6103064/"
          }
        ]
      },
      "16:9": {
        "values": {
          "photo-1": "https://images.pexels.com/photos/30140363/pexels-photo-30140363.jpeg?auto=compress&cs=tinysrgb&h=650&w=940"
        },
        "credits": [
          {
            "text": "Photo by Stephen Leonardi on Pexels",
            "url": "https://www.pexels.com/photo/misty-mountain-silhouette-with-pine-trees-30140363/"
          }
        ]
      }
    }
  },
  {
    "id": "brand-reveal",
    "name": "Brand Reveal",
    "category": "Brand intros",
    "description": "A clean logo intro: geometric shapes assemble into a stage, your logo lands with a soft glow, the name rises letter by letter and the tagline and web address sign off.",
    "ratios": [
      "16:9",
      "1:1",
      "9:16",
      "4:5"
    ],
    "previews": {
      "16:9": {
        "values": {},
        "credits": []
      },
      "1:1": {
        "values": {},
        "credits": []
      },
      "9:16": {
        "values": {},
        "credits": []
      },
      "4:5": {
        "values": {},
        "credits": []
      }
    }
  }
];
