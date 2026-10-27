import { Calculator, FolderOpen, Highlighter, NotebookPen, Paperclip, PencilRuler, PenLine, Scissors } from 'lucide-react'

// Everything the public website says about the business, in one place

export const SHOP = {
  name: 'Royal Stationers',
  phone: '0321-4577629',
  phoneIntl: '923214577629',
  email: 'royalstationer862@gmail.com',
  addressLines: ['Shop #22, First Floor, Bashir Center', '14 Kabeer Street, Urdu Bazar', 'Lahore 54000, Pakistan'],
  addressShort: 'Shop #22, First Floor, Bashir Center, Urdu Bazar, Lahore',
  hours: 'Monday to Saturday, 9:30 am to 8:00 pm',
  hoursNote: 'Friday break 1:00 to 2:30 pm. Sunday closed.',
  rating: '4.8',
  mapUrl: 'https://www.google.com/maps/place/Royal+Stationers/data=!4m2!3m1!1s0x0:0x5250e8685b3ba536',
  directionsUrl: 'https://www.google.com/maps/dir/?api=1&destination=Royal+Stationers+Bashir+Center+Urdu+Bazar+Lahore',
  mapEmbedUrl: 'https://www.google.com/maps?q=Royal+Stationers,+Bashir+Center,+14+Kabeer+St,+Urdu+Bazar,+Lahore&output=embed',
}

export const DEFAULT_WA_TEXT = 'Assalam o Alaikum, mujhe Royal Stationers ki rate list chahiye.'

export const waLink = (text = DEFAULT_WA_TEXT) => `https://wa.me/${SHOP.phoneIntl}?text=${encodeURIComponent(text)}`

export const BRANDS = ['next', 'Zuofan', 'Ruya', 'Chanyi', 'Citizen']

export const CATEGORIES = [
  { icon: Calculator, name: 'Calculators', text: 'Desktop, scientific and pocket models', items: ['Desktop calculators', 'Scientific calculators', 'Pocket calculators'] },
  { icon: PenLine, name: 'Pens and ink pens', text: 'Ball pens, gel pens and fountain ink pens', items: ['Ball pens', 'Gel pens', 'Ink pens and refills'] },
  { icon: Highlighter, name: 'Markers and highlighters', text: 'Board markers, permanent and neon', items: ['White board markers', 'Permanent markers', 'Highlighters'] },
  { icon: FolderOpen, name: 'Files and folders', text: 'Box files, clear bags and document cases', items: ['Box and lever files', 'Clear bags', 'Document cases'] },
  { icon: Scissors, name: 'Tape, glue and scissors', text: 'Clear tape, glue sticks and cutters', items: ['Clear and packing tape', 'Glue sticks and liquid glue', 'Scissors and cutters'] },
  { icon: Paperclip, name: 'Staplers and pins', text: 'Staplers, pins, clips and punches', items: ['Staplers', 'Stapler pins', 'Paper clips and punches'] },
  { icon: NotebookPen, name: 'Notebooks and registers', text: 'Exercise books, registers and diaries', items: ['Exercise books', 'Registers', 'Diaries and note pads'] },
  { icon: PencilRuler, name: 'School supplies', text: 'Pencil boxes, geometry sets and globes', items: ['Pencil boxes', 'Geometry sets', 'Globes and school items'] },
]
