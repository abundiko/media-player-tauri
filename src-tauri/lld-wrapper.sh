#!/bin/bash
# Wrapper for x86_64-w64-mingw32-gcc that forces use of ld.lld instead of
# the default GNU ld (which can't handle the windows crate's huge export list).
# We use lld-link (the Windows PE driver of LLD) to perform the final link,
# translating GCC-style arguments to MSVC-style ones.

# If this looks like a simple compile step (not linking), pass through.
if ! echo "$@" | grep -q -- "-o .*\.\(exe\|dll\)"; then
    exec x86_64-w64-mingw32-gcc "$@"
fi

# For the final link, invoke lld-link.
# Collect the object files and libraries.
ARGS=()
LINKER_SCRIPT=
SUBSYSTEM=console

while [ "$#" -gt 0 ]; do
    case "$1" in
        -o) shift; ARGS+=("-out:$1") ;;
        -shared) ARGS+=("-dll") ;;
        -Wl,*) IFS=',' read -ra WOPT <<< "${1#-Wl,}"; for w in "${WOPT[@]}"; do
            case "$w" in
                --out-implib=*) ARGS+=("-implib:${w#--out-implib=}") ;;
                --gc-sections) ;;
                --nxcompat) ARGS+=("-nxcompat") ;;
                --dynamicbase) ARGS+=("-dynamicbase") ;;
                --disable-auto-image-base) ;;
                --high-entropy-va) ARGS+=("-highentropyva") ;;
                *) ARGS+=("$w") ;;
            esac
        done ;;
        -L*) ARGS+=("-libpath:${1#-L}") ;;
        -l*) ARGS+=("${1#-l}.lib") ;;
        -m64) ;;
        -fno-use-linker-plugin) ;;
        -nodefaultlibs) ;;
        -Bstatic) ;;
        -Bdynamic) ;;
        -fuse-ld=*) ;;
        *.o|*.rlib|*.obj) ARGS+=("$1") ;;
        *.a) ARGS+=("$1") ;;
        *.dll.a) ARGS+=("$1") ;;
        *.def) ARGS+=("-def:$1") ;;
        /tmp/rustc*/list.def) ARGS+=("-def:$1") ;;
        *.dll) [ -f "$1" ] && ARGS+=("$1") ;;
        -e) shift; ARGS+=("-entry:$1") ;;
        -entry:*) ARGS+=("$1") ;;
        -subsystem:*) ARGS+=("$1") ;;
        -defaultlib:*) ARGS+=("$1") ;;
        *) # pass through unrecognized flags as-is
            ARGS+=("$1") ;;
    esac
    shift
done

# Add default libraries
ARGS+=("-defaultlib:msvcrt" "-defaultlib:oldnames" "-defaultlib:kernel32" "-defaultlib:user32" "-defaultlib:advapi32" "-defaultlib:ws2_32" "-defaultlib:ntdll" "-defaultlib:userenv" "-defaultlib:dbghelp")

exec lld-link "${ARGS[@]}"
