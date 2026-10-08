import java.nio.file.Files;
import java.nio.file.Path;
import rhino.Context;

class ValidateMindustry {
    public static void main(String[] args) throws Exception {
        Context context = Context.enter();
        try {
            context.setLanguageVersion(200);
            context.compileString(Files.readString(Path.of(args[0])), "main.js", 1);
            System.out.println("PASS: script compiles with installed Mindustry Rhino engine.");
        } finally { Context.exit(); }
    }
}
