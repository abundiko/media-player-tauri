import { ModalOverlay, Modal, Dialog, Heading, Button } from 'react-aria-components'

const SUPPORTED_VIDEO = '.mp4, .mkv, .avi, .mov, .wmv, .flv, .webm, .m4v, .mpg, .mpeg'
const SUPPORTED_AUDIO = '.mp3, .flac, .wav, .aac, .ogg, .opus, .m4a, .wma, .ac3, .dts'

interface ErrorModalProps {
  isOpen: boolean
  onOpenChange: (isOpen: boolean) => void
}

export function ErrorModal({ isOpen, onOpenChange }: ErrorModalProps) {
  return (
    <ModalOverlay
      isDismissable
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      className={({ isEntering, isExiting }) =>
        `fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-xl ${
          isEntering ? 'animate-fade-in' : ''
        } ${isExiting ? 'animate-fade-out' : ''}`
      }
      style={{ background: 'var(--surface-alt)' }}
    >
      <Modal
        className={({ isEntering, isExiting }) =>
          `outline-hidden w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg ring-1 ring-ring ${
            isEntering ? 'animate-scale-in' : ''
          } ${isExiting ? 'animate-scale-out' : ''}`
        }
      >
        <Dialog className="outline-hidden">
          <Heading slot="title" className="mb-4 text-lg font-semibold text-text">
            Unsupported format
          </Heading>
          <p className="mb-4 text-sm text-text-muted">
            The dropped file is not a supported format. Please drop a video or audio file.
          </p>
          <div className="mb-6 space-y-2 text-sm">
            <p className="font-medium text-text">Supported video formats:</p>
            <p className="text-text-muted">{SUPPORTED_VIDEO}</p>
            <p className="font-medium text-text">Supported audio formats:</p>
            <p className="text-text-muted">{SUPPORTED_AUDIO}</p>
          </div>
          <div className="flex justify-end">
            <Button
              slot="close"
              className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-surface-hover"
            >
              Close
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  )
}
