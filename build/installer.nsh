; Removes the Explorer entries the app adds from its settings menu
; (src/main/shellIntegration.ts — keep both lists in sync). Skipped on update: the old
; version's uninstaller runs then too, and the new version rewrites them at startup.

!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegKey HKCU "Software\Classes\MediaCast.Video"
    DeleteRegKey HKCU "Software\Classes\MediaCast.Torrent"
    DeleteRegKey HKCU "Software\Classes\Applications\media-cast.exe"
    !insertmacro mediaCastUnregister ".mp4" "MediaCast.Video"
    !insertmacro mediaCastUnregister ".mkv" "MediaCast.Video"
    !insertmacro mediaCastUnregister ".avi" "MediaCast.Video"
    !insertmacro mediaCastUnregister ".torrent" "MediaCast.Torrent"
    !insertmacro mediaCastUnregister ".magnet" "MediaCast.Torrent"
    Delete "$APPDATA\Microsoft\Windows\SendTo\Media Cast.lnk"
  ${endIf}
!macroend

!macro mediaCastUnregister EXT PROGID
  DeleteRegValue HKCU "Software\Classes\${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${EXT}\shell\MediaCast"
!macroend
